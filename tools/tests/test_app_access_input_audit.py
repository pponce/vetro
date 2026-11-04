import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


TOOLS = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('app_access_input_audit', TOOLS / 'app_access_input_audit.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def installed_agent_shell_argument(command):
    # Model SamsungTvRootAgent.QuoteArgument plus .NET 6 Process.Unix.cs
    # GetNextArgument. In particular, ordinary backslashes remain literal;
    # only runs immediately before a double quote have special treatment.
    argument = '"' + command.replace('\\', '\\\\').replace('"', '\\"') + '"'
    index, quoted, result = 0, False, []
    while index < len(argument):
        count = 0
        while index < len(argument) and argument[index] == '\\':
            index += 1
            count += 1
        if count:
            if index == len(argument) or argument[index] != '"':
                result.append('\\' * count)
            else:
                result.append('\\' * (count // 2))
                if count % 2:
                    result.append('"')
                    index += 1
            continue
        value = argument[index]
        if value == '"':
            if quoted and index + 1 < len(argument) and argument[index + 1] == '"':
                result.append('"')
                index += 1
            else:
                quoted = not quoted
        elif value in ' \t' and not quoted:
            raise AssertionError('Command unexpectedly split into multiple arguments')
        else:
            result.append(value)
        index += 1
    return ''.join(result)


class InputAuditTests(unittest.TestCase):
    def test_real_shell_fake_proc_correlates_services_and_masks_arguments(self):
        with tempfile.TemporaryDirectory(prefix='.input-audit-', dir=Path(__file__).parent) as temporary:
            proc = Path(temporary) / 'proc'
            (proc / 'net').mkdir(parents=True)

            def process(pid, comm, args, descriptors):
                directory = proc / str(pid)
                (directory / 'fd').mkdir(parents=True)
                (directory / 'comm').write_text(comm + '\n')
                (directory / 'cmdline').write_bytes(b'\0'.join(arg.encode() for arg in args) + b'\0')
                (directory / 'status').write_text('PPid:\t1\nUid:\t0\t0\t0\t0\n')
                (directory / 'stat').write_text(str(pid) + ' (' + comm + ') S ' + ' '.join(['0'] * 18) + ' 12345\n')
                (directory / 'exe').symlink_to('/usr/bin/dotnet' if comm != 'node' else '/usr/bin/node')
                for number, target in descriptors.items():
                    (directory / 'fd' / str(number)).symlink_to(target)

            def helper(port, node):
                return ['/usr/bin/dotnet', '/opt/usr/apps/vetrotvapp/res/wgt/payload/SamsungTvRemoteInputAgent.dll',
                        '127.0.0.1', str(port), '/tmp/SECRET_INPUT_TOKEN.token', 'Smart Control 2016@/dev/input/event' + str(node),
                        'evdev', 'TV', 'filter', '63']

            process(41, 'node', ['node', 'SECRET_SERVICE_COMMAND'], {4: 'socket:[900]', 5: 'socket:[902]'})
            process(42, 'node', ['node', 'SECRET_CURRENT_COMMAND'], {4: 'socket:[903]', 5: 'socket:[905]', 6: 'socket:[906]'})
            process(99, 'SamsungTvRemote', helper(4000, 6), {4: '/dev/input/event6', 5: '/dev/uinput', 6: 'socket:[901]'})
            process(101, 'SamsungTvRemote', helper(5000, 7), {4: '/dev/input/event7', 5: 'socket:[907]'})
            process(100, 'dotnet', ['dotnet', '/opt/usr/apps/vetrotvapp/res/wgt/native/dock/tvlauncher-dotnet.dll', '--hidden', '--home-code', '63', '--config', '/tmp/SECRET_CONFIG'], {4: '/dev/input/event6'})
            process(102, 'dotnet', ['dotnet', '/another/tvlauncher-dotnet.dll', '--mapped-home', '--hidden'], {})

            def tcp(inode, local, remote, state='01', local_address='0100007F', remote_address='0100007F'):
                return f'0: {local_address}:{local:04X} {remote_address}:{remote:04X} {state} 0:0 0:0 0 0 0 {inode}\n'

            (proc / 'net/tcp').write_text('header\n' + tcp(900, 4000, 0, '0A', remote_address='00000000') +
                                          tcp(901, 44000, 4000) + tcp(902, 4000, 44000) +
                                          tcp(903, 8099, 0, '0A', '00000000', '00000000') +
                                          tcp(905, 5000, 0, '0A', remote_address='00000000') + tcp(906, 5000, 44001) + tcp(907, 44001, 5000))
            (proc / 'net/tcp6').write_text('header\n')
            script = audit._script(42).replace('/proc', str(proc))
            broken = subprocess.run(['sh', '-c', installed_agent_shell_argument(script)], capture_output=True, text=True, timeout=10)
            self.assertEqual(broken.returncode, 0, broken.stderr)
            self.assertIn('VETRO_INPUT_AUDIT|1\\nSERVICE|42\\n', broken.stdout)
            self.assertFalse(audit.summarize({'exit_code': 0, 'output': broken.stdout})['complete'])
            envelope = audit._shell_envelope(script)
            self.assertNotIn('\\', envelope)
            self.assertEqual(installed_agent_shell_argument(envelope), envelope)
            result = subprocess.run(['sh', '-c', installed_agent_shell_argument(envelope)], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stderr, '')
            self.assertNotIn('SECRET', result.stdout)
            report = audit.summarize({'exit_code': 0, 'timed_out': False, 'output': result.stdout})
            self.assertTrue(report['complete'], report)
            self.assertEqual(report['coverage'], 'best-effort-non-atomic')
            self.assertIn('unreadable /proc entries may be absent', report['limitation'])
            self.assertEqual(report['currentServicePid'], 42)
            old, current = sorted(report['helpers'], key=lambda item: item['pid'])
            self.assertEqual(old['callbackListenerPids'], [41])
            self.assertEqual(old['callbackConnectionPids'], [41])
            self.assertFalse(old['currentServiceConnectionObserved'])
            self.assertEqual(current['callbackConnectionPids'], [42])
            self.assertTrue(current['currentServiceConnectionObserved'])
            self.assertEqual(report['launchers'], [{'pid': 100, 'mappedHome': False, 'homeCode': 63, 'hidden': True}, {'pid': 102, 'mappedHome': True, 'homeCode': None, 'hidden': True}])
            input_processes = [item['pid'] for item in report['processes'] if any(fd['kind'] == 'input' for fd in item['fds'])]
            self.assertEqual(sorted(input_processes), [99, 100, 101])
            self.assertTrue(all(item['startTicks'] == 12345 for item in report['processes']))
            self.assertNotIn('SECRET', json.dumps(report))

    def test_envelope_preserves_printf_and_null_record_delimiters(self):
        script = r"printf 'Smart Control 2016\000Second\000' | tr '\000' '\n'"
        broken = subprocess.run(['sh', '-c', installed_agent_shell_argument(script)], capture_output=True, text=True, check=True)
        self.assertNotEqual(broken.stdout, 'Smart Control 2016\nSecond\n')
        fixed = subprocess.run(['sh', '-c', installed_agent_shell_argument(audit._shell_envelope(script))], capture_output=True, text=True, check=True)
        self.assertEqual(fixed.stdout, 'Smart Control 2016\nSecond\n')
        self.assertLess(len(audit.command(42).encode()), 65536)

    def test_partial_and_malformed_output_never_becomes_complete(self):
        for value in [None, True, -1, 0, '12; kill', 2147483648]:
            with self.assertRaises(ValueError):
                audit.command(value)
        good = 'VETRO_INPUT_AUDIT|1\nSERVICE|42\nEND|12|1\n'
        self.assertTrue(audit.summarize({'output': good, 'exit_code': 0})['complete'])
        for value in [good.replace('END|12|1', ''), good.replace('END', 'LIMIT|fd\nEND'), 'SECRET' * 20000]:
            self.assertFalse(audit.summarize({'output': value, 'exit_code': 0})['complete'])
        self.assertFalse(audit.summarize({'output': good, 'exit_code': 0, 'timed_out': True})['complete'])
        self.assertFalse(audit.summarize({'output': good, 'exit_code': 1})['complete'])
        bad = good + 'PROCESS|5|1|0|bad/token/path|dotnet|1\nFD|5|2|input|/tmp/SECRET.token\n'
        self.assertEqual(audit.summarize({'output': bad, 'exit_code': 0})['processes'], [])


if __name__ == '__main__':
    unittest.main()
