import importlib.util
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

TOOLS = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location('diagnose_app_access', TOOLS / 'diagnose-app-access.py')
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)


def encoded(values):
    return '|'.join(value.encode().hex() for value in values)


def fixture(base=None, owner=None, base_rc=0, owner_rc=0, complete=True, stderr=''):
    rows = base if base is not None else [['base', M.TARGET, 'GlassHome1', 'wgt', 'uiapp', 'false', 'true', '1.0', 'false', 'false', 'false']]
    output = [M.PREFIX + '|base|start'] + [encoded(row) for row in rows]
    output += [M.PREFIX + '|base|end|' + str(base_rc) + '|1', M.PREFIX + '|owner|start', M.PREFIX + '|owner|present']
    output += [encoded(row) for row in (owner or [])]
    output += [M.PREFIX + '|owner|end|' + str(owner_rc) + '|0']
    if complete:
        output += [encoded(['complete']), M.PREFIX + '|done']
    return {'exit_code': 0, 'timed_out': False, 'output': '\n'.join(output), 'stderr': stderr}


def old_agent_command(command):
    # QuoteArgument in the installed SamsungTvRootAgent.cs, followed by the
    # single-argument rules from dotnet/runtime v6.0.0 Process.Unix.cs
    # GetNextArgument (lines 853-928). Only slashes before a quote are halved.
    text = '"' + command.replace('\\', '\\\\').replace('"', '\\"') + '"'
    result, position, in_quotes = [], 0, False
    while position < len(text):
        count = 0
        while position < len(text) and text[position] == '\\':
            count += 1
            position += 1
        if count:
            if position == len(text) or text[position] != '"':
                result.append('\\' * count)
            else:
                result.append('\\' * (count // 2))
                if count % 2:
                    result.append('"')
                    position += 1
            continue
        character = text[position]
        if character == '"':
            if in_quotes and position + 1 < len(text) and text[position + 1] == '"':
                result.append('"')
                position += 1
            else:
                in_quotes = not in_quotes
        else:
            result.append(character)
        position += 1
    return ''.join(result)


class DiagnosticTests(unittest.TestCase):
    def test_shell_through_installed_argument_quoting_preserves_framing(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary)
            fake_sqlite = directory / 'sqlite3'
            rows = [['base', M.TARGET, 'GlassHome1', 'wgt', 'uiapp', 'false', 'true', '1.0', 'false', 'false', 'false']]
            rows += [['base', 'private.app' + str(i), 'private.package' + str(i), 'wgt', 'uiapp', 'false', 'true', '1', 'false', 'false', 'false'] for i in range(585)]
            fake_sqlite.write_text('#!' + sys.executable + '\nprint(' + repr('\n'.join(encoded(row) for row in rows)) + ')\n')
            fake_sqlite.chmod(0o700)
            command = M.registry_command(5001).replace('/opt/dbspace/user/5001/.pkgmgr_parser.db', str(directory / 'absent-owner.db'))
            self.assertNotIn('\\', command)
            old = command.replace("\n'", "\\n'")
            env = dict(os.environ, PATH=str(directory) + os.pathsep + os.environ.get('PATH', ''))
            def execute(source):
                result = subprocess.run(['sh', '-c', old_agent_command(source)], text=True, capture_output=True, env=env, timeout=10)
                return M.parse_registry({'exit_code': result.returncode, 'timed_out': False, 'output': result.stdout, 'stderr': result.stderr})
            broken = execute(old)
            self.assertEqual(broken['unexpectedRows'], 587)
            self.assertEqual(broken['invalidHexRows'], 0)
            self.assertEqual(broken['base']['rows'], 0)
            self.assertFalse(broken['diagnosticComplete'])
            self.assertFalse(broken['completionMarker'])
            self.assertIn('base_result_unavailable', broken['readerRejectionReasons'])
            self.assertNotIn('base_query_failed', broken['readerRejectionReasons'])
            fixed = execute(command)
            self.assertTrue(fixed['diagnosticComplete'], fixed)
            self.assertTrue(fixed['completionMarker'])
            self.assertTrue(fixed['sourceReaderFactsAccepted'])
            self.assertEqual(fixed['base']['rows'], 586)
            self.assertEqual(fixed['target']['rows'], 1)
            self.assertEqual(fixed['base']['exitCode'], 0)
            self.assertEqual(fixed['owner']['exitCode'], 0)
            self.assertNotIn('private.app', json.dumps(fixed))

    def test_exact_service_queries(self):
        # Host-tool branches need not contain the application candidate. Execute
        # the immutable installed source fixture instead of silently testing a
        # different checkout's SQL. No network is needed by this regression.
        fixture = json.loads((TOOLS / 'tests/fixtures/permission-registry-fc0.json').read_text())
        self.assertEqual(fixture['revision'], 'fc0b236878a2249906edf774888f5a39f46842c0')
        self.assertEqual(hashlib.sha256(fixture['source'].encode()).hexdigest(), fixture['sha256'])
        script = """const fs=require('fs'),vm=require('vm');
const source=JSON.parse(fs.readFileSync(0,'utf8')).source;
const sandbox={module:{exports:{}},process:{getuid:()=>5001},require:()=>({}),Buffer};
vm.runInNewContext(source,sandbox);
sandbox.module.exports.load(c=>{console.log(c);return Promise.reject(Error());}).catch(()=>{});
"""
        result = subprocess.run(['node', '-e', script], input=json.dumps(fixture), cwd=TOOLS.parent,
                                text=True, capture_output=True, check=True)
        for sql in M.registry_sql(5001):
            self.assertIn(sql, result.stdout)
            self.assertIn(sql, M.registry_command(5001))
        command = M.registry_command(5001)
        self.assertIn('/opt/dbspace/user/5001/.pkgmgr_parser.db', command)
        self.assertEqual(command.count('sqlite3 -readonly'), 2)
        self.assertNotRegex(command, r'UPDATE|DELETE|INSERT|chmod|kill|pkill|\.token')
        for uid in ['5001', -1, True, 2**40, None]:
            with self.assertRaises(ValueError):
                M.registry_command(uid)

    def test_live_rows_target_only_and_owner_precedence(self):
        base = [['base', M.TARGET, 'GlassHome1', 'wgt', 'uiapp', 'false', 'true', '1.0', 'false', 'false', 'false'],
                ['base', 'private.secret.app', 'private.package', 'native', 'svcapp', 'false', 'false', '9', 'true', 'true', 'true']]
        result = M.parse_registry(fixture(base, [['owner', M.TARGET, 'true']]))
        self.assertTrue(result['sourceReaderFactsAccepted'])
        self.assertEqual(result['target']['effectiveDisabled'], True)
        self.assertEqual(result['base']['rows'], 2)
        self.assertNotIn('private.secret', json.dumps(result))
        self.assertNotIn('private.package', json.dumps(result))

    def test_schema_duplicate_invalid_and_truncation(self):
        result = M.parse_registry(fixture(owner_rc=1, complete=False, stderr=M.PREFIX+'|owner\nError: no such table: package_app_info_for_uid token=SECRET'))
        self.assertEqual(result['owner']['errorCategory'], 'missing_table')
        self.assertIn('owner_query_failed', result['readerRejectionReasons'])
        self.assertNotIn('SECRET', json.dumps(result))
        row = ['base', 'invalid id', '', 'wgt', 'uiapp', '', '', '', '', '', '']
        result = M.parse_registry(fixture([row, row]))
        self.assertEqual(result['base']['invalidAppIds'], 2)
        self.assertEqual(result['base']['duplicateAppIds'], 1)
        self.assertEqual(result['base']['invalidPackageIds'], 2)
        self.assertFalse(result['sourceReaderFactsAccepted'])
        result = M.parse_registry(fixture(complete=False))
        self.assertFalse(result['sourceReaderFactsAccepted'])
        result = fixture();result['output'] += '\n'+encoded(['base','after'])
        self.assertFalse(M.parse_registry(result)['sourceReaderFactsAccepted'])
        self.assertEqual(M.parse_registry({'output':'x'*(M.MAX_OUTPUT+1)})['failure'], 'invalid_or_oversized_output')

    def test_input_summaries_never_copy_raw_logs_or_keys(self):
        secret = 'abcdef0123456789'*4
        result = M.input_log_summary({'exit_code':0,'output':'IOException: EVIOCGRAB /dev/input/event6 failed with errno 16\n/tmp/vetro-input-'+secret+'.token\nAUTH '+secret+'\n[GC_INFO] GC_End'})
        self.assertEqual(result['lines'][0], {'kind':'grab_failed','node':'/dev/input/event6','errno':16})
        self.assertNotIn(secret,json.dumps(result))
        value=M.limited_input({'devices':[{'name':secret,'node':'/dev/input/event4','selectable':False}],
            'status':{'policy':{'mode':'off','connected':False},'preference':{'enabled':True,'node':'/dev/input/event4','secret':secret},'events':[secret]},
            'error':'input helper disconnected; original keys released'})
        self.assertTrue(value['savedNodePresent']);self.assertEqual(value['errorCategory'],'helper_disconnected')
        self.assertNotIn(secret,json.dumps(value))

    def test_owner_collection_uses_service_uid_readonly_and_isolates_failure(self):
        calls=[]
        class Owner:
            def request(self, route, body=None, timeout=None):
                calls.append((route,body,timeout))
                if route=='/status':
                    return {'self':{'uid':5001,'pid':42},'agent':{'connected':True},'app':{'sourceRevision':'a'*40,'sourceDirty':False},'secret':'never'}
                if route=='/app-access':
                    return {'enabled':True,'available':True,'error':None,'grants':[{'token':'never'}],'pending':[], 'events':[{'appId':M.TARGET,'method':'access.request','outcome':'unavailable'}]}
                if route=='/input':
                    raise RuntimeError('never disclose this secret')
                if M.PREFIX in body['cmd']:
                    return fixture(owner_rc=1,complete=False)
                return {'exit_code':0,'output':'AUTH never'}
        result=M.collect(Owner())
        self.assertEqual(result['sections']['status']['data']['serviceUid'],5001)
        self.assertEqual(result['sections']['status']['data']['sourceRevision'],'a'*40)
        self.assertFalse(result['sections']['input']['ok'])
        self.assertEqual(result['sections']['input']['errorType'],'RuntimeError')
        self.assertNotIn('never',json.dumps(result))
        self.assertEqual([route for route,_,_ in calls if route!='/exec'],['/status','/app-access','/input'])
        self.assertTrue(any('/user/5001/' in (body or {}).get('cmd','') for _,body,_ in calls))


if __name__ == '__main__':
    unittest.main()
