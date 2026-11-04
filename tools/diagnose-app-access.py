#!/usr/bin/env python3
"""Read app-permission eligibility and remote-input evidence through paired Vetro."""
import argparse
import datetime
import ipaddress
import json
import re
import shlex
import time
from collections import Counter
from pathlib import Path

from vetro_owner import OwnerClient
try:
    import app_access_input_audit
except ImportError:
    app_access_input_audit = None

TARGET = 'GlassHome1.GlassHome'
MAX_OUTPUT = 2 * 1024 * 1024
VALID_ID = re.compile(r'[A-Za-z0-9_.-]{1,180}\Z')
PREFIX = '__VETRO_ACCESS_DIAGNOSTIC__'


def registry_sql(uid):
    if type(uid) is not int or not 0 <= uid <= 2147483647:
        raise ValueError('Invalid Vetro service UID')
    base = ("SELECT hex('base'),hex(a.app_id),hex(a.package),hex(a.app_type),hex(a.app_component),"
            'hex(COALESCE(u.is_disabled,a.app_disable)),hex(a.app_removable),hex(p.package_version),'
            'hex(p.package_system),hex(p.package_preload),hex(a.app_nodisplay) '
            'FROM package_app_info a LEFT JOIN package_info p ON p.package=a.package '
            'LEFT JOIN package_app_info_for_uid u ON u.app_id=a.app_id AND u.uid=' + str(uid) + ';')
    owner = "SELECT hex('owner'),hex(app_id),hex(is_disabled) FROM package_app_info_for_uid WHERE uid=" + str(uid) + ';'
    return base, owner


def registry_command(uid):
    base, owner = registry_sql(uid)
    owner_file = '/opt/dbspace/user/' + str(uid) + '/.pkgmgr_parser.db'
    # Identical read-only SQL and optional-file semantics to the service reader.
    # Extra fixed delimiters identify stages without writing a TV file. Keep
    # literal newlines in printf formats: the installed agent's Arguments
    # quoting doubles backslashes before the shell receives this command.
    return '\n'.join([
        "printf '%s\n' '" + PREFIX + "|base|start'",
        "printf '%s\n' '" + PREFIX + "|base' >&2",
        'vetro_diag_started=$(date +%s)',
        'sqlite3 -readonly "/opt/dbspace/.pkgmgr_parser.db" "' + base + '"',
        'vetro_diag_base_rc=$?',
        'vetro_diag_base_seconds=$(($(date +%s)-vetro_diag_started))',
        "printf '%s|base|end|%s|%s\n' '" + PREFIX + "' \"$vetro_diag_base_rc\" \"$vetro_diag_base_seconds\"",
        "printf '%s\n' '" + PREFIX + "|owner|start'",
        "printf '%s\n' '" + PREFIX + "|owner' >&2",
        'vetro_diag_started=$(date +%s)',
        'vetro_diag_owner_rc=0',
        'if [ -e "' + owner_file + '" ] || [ -L "' + owner_file + '" ]; then',
        "printf '%s\n' '" + PREFIX + "|owner|present'",
        'sqlite3 -readonly "' + owner_file + '" "' + owner + '"',
        'vetro_diag_owner_rc=$?',
        'else',
        "printf '%s\n' '" + PREFIX + "|owner|absent'",
        'fi',
        'vetro_diag_owner_seconds=$(($(date +%s)-vetro_diag_started))',
        "printf '%s|owner|end|%s|%s\n' '" + PREFIX + "' \"$vetro_diag_owner_rc\" \"$vetro_diag_owner_seconds\"",
        'if [ "$vetro_diag_base_rc" -eq 0 ] && [ "$vetro_diag_owner_rc" -eq 0 ]; then',
        "printf '%s\n' 636f6d706c657465",
        'fi',
        "printf '%s\n' '" + PREFIX + "|done'",
    ])


def error_category(value):
    text = str(value or '').lower()
    for pattern, category in [('no such table', 'missing_table'), ('no such column', 'missing_column'),
                              ('locked', 'locked'), ('permission denied', 'permission_denied'),
                              ('unable to open', 'cannot_open'), ('malformed', 'malformed_database'),
                              ('not a database', 'invalid_database'), ('not found', 'command_not_found'),
                              ('timed out', 'timeout'), ('timeout', 'timeout')]:
        if pattern in text:
            return category
    return 'other_error' if text.strip() else None


def boolean(value):
    return True if value == 'true' else False if value == 'false' else None


def parse_registry(result):
    output = result.get('output', '') if isinstance(result, dict) else ''
    stderr = result.get('stderr', '') if isinstance(result, dict) else ''
    report = {'base': {}, 'owner': {}, 'completionMarker': False, 'diagnosticComplete': False,
              'invalidHexRows': 0, 'wrongFieldCountRows': 0, 'unexpectedRows': 0,
              'originalExecutionBudgetMs': 4000, 'diagnosticExecutionBudgetMs': 30000}
    if not isinstance(output, str) or len(output.encode('utf-8')) > MAX_OUTPUT:
        report['failure'] = 'invalid_or_oversized_output'
        return report
    report['execExitCode'] = result.get('exit_code') if type(result.get('exit_code')) is int else None
    report['timedOut'] = result.get('timed_out') is True
    report['encodedBytes'] = 0
    rows, owner_rows = [], []
    active = None
    for line in output.splitlines():
        if line.startswith(PREFIX + '|'):
            parts = line.split('|')
            if len(parts) == 2 and parts[1] == 'done':
                report['diagnosticComplete'] = True
            elif len(parts) == 3 and parts[1] in ('base', 'owner'):
                active = parts[1]
                if parts[2] in ('present', 'absent'):
                    report[active]['present'] = parts[2] == 'present'
            elif len(parts) == 5 and parts[1] in ('base', 'owner') and parts[2] == 'end':
                try:
                    report[parts[1]].update(exitCode=int(parts[3]), elapsedSeconds=int(parts[4]))
                except ValueError:
                    report['unexpectedRows'] += 1
            else:
                report['unexpectedRows'] += 1
            continue
        if not line:
            continue
        report['encodedBytes'] += len(line.encode('utf-8')) + 1
        if report['completionMarker']:
            report['unexpectedRows'] += 1
        fields = line.split('|')
        try:
            if any(not re.fullmatch(r'(?:[a-fA-F0-9]{2})*', item) for item in fields):
                raise ValueError('Invalid hex')
            fields = [bytes.fromhex(item).decode('utf-8', errors='replace') for item in fields]
        except ValueError:
            report['invalidHexRows'] += 1
            continue
        if fields == ['complete']:
            report['completionMarker'] = True
        elif fields[0] == 'base' and active == 'base':
            if len(fields) != 11:
                report['wrongFieldCountRows'] += 1
            else:
                rows.append(fields)
        elif fields[0] == 'owner' and active == 'owner':
            if len(fields) != 3:
                report['wrongFieldCountRows'] += 1
            else:
                owner_rows.append(fields)
        else:
            report['unexpectedRows'] += 1
    # SQLite diagnostics stay in memory; only a fixed category reaches the report.
    stage = None
    messages = {'base': [], 'owner': []}
    for line in str(stderr).splitlines():
        if line in (PREFIX + '|base', PREFIX + '|owner'):
            stage = line.rsplit('|', 1)[1]
        elif stage:
            messages[stage].append(line)
    for stage, records in [('base', rows), ('owner', owner_rows)]:
        counts = Counter(row[1] for row in records)
        report[stage].update(rows=len(records), duplicateAppIds=sum(n > 1 for n in counts.values()),
                             invalidAppIds=sum(not bool(VALID_ID.fullmatch(row[1])) for row in records),
                             errorCategory=error_category('\n'.join(messages[stage])))
    report['base']['invalidPackageIds'] = sum(not bool(VALID_ID.fullmatch(row[2])) for row in rows)
    targets = [row for row in rows if row[1] == TARGET]
    target_overrides = [row for row in owner_rows if row[1] == TARGET]
    report['target'] = {'appId': TARGET, 'rows': len(targets), 'ownerOverrideRows': len(target_overrides)}
    if len(targets) == 1:
        row = targets[0]
        report['target'].update(packageId=row[2] if VALID_ID.fullmatch(row[2]) else None,
            version=row[7] if re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', row[7]) else None,
            type=row[3] if row[3] in ('wgt', 'webapp', 'dotnet', 'native') else 'other',
            component=row[4] if row[4] in ('uiapp', 'svcapp') else 'other',
            globalDisabled=boolean(row[5]),removable=boolean(row[6]),system=boolean(row[8]),
            preload=boolean(row[9]),show=None if boolean(row[10]) is None else not boolean(row[10]),
            effectiveDisabled=boolean(target_overrides[0][2]) if len(target_overrides) == 1 else boolean(row[5]),
            packageSiblingRows=sum(item[2] == row[2] for item in rows))
    reasons = []
    if report['execExitCode'] != 0 or report['timedOut']:
        reasons.append('execution_failed')
    if not report['diagnosticComplete'] or not report['completionMarker']:
        reasons.append('incomplete_output_or_query_failure')
    if any(report[key] for key in ('invalidHexRows', 'wrongFieldCountRows', 'unexpectedRows')):
        reasons.append('invalid_output_framing')
    for stage in ('base', 'owner'):
        if report[stage].get('exitCode') is None:
            reasons.append(stage + '_result_unavailable')
        elif report[stage]['exitCode'] != 0:
            reasons.append(stage + '_query_failed')
        if report[stage]['duplicateAppIds'] or report[stage]['invalidAppIds']:
            reasons.append(stage + '_invalid_or_duplicate_app_ids')
    if report['base']['invalidPackageIds']:
        reasons.append('invalid_package_ids')
    report['readerRejectionReasons'] = reasons
    report['sourceReaderFactsAccepted'] = not reasons
    return report


def limited_input(data):
    def node(value):
        return value if isinstance(value, str) and re.fullmatch(r'/dev/input/event[0-9]{1,4}', value) else None
    def category(value):
        text = str(value or '').lower()
        for match, label in [('disconnected', 'helper_disconnected'), ('did not connect', 'helper_connect_timeout'),
                             ('not found', 'remote_not_found'), ('unique', 'selection_not_unique'), ('authentication', 'authentication_failed')]:
            if match in text:
                return label
        return 'other_error' if text else None
    if not isinstance(data, dict):
        return {'error': 'invalid_response'}
    state = data.get('status') if isinstance(data.get('status'), dict) else {}
    policy = state.get('policy') if isinstance(state.get('policy'), dict) else {}
    pref = state.get('preference') if isinstance(state.get('preference'), dict) else {}
    home = data.get('home') if isinstance(data.get('home'), dict) else {}
    devices = data.get('devices') if isinstance(data.get('devices'), list) else []
    return {'deviceCount': len(devices), 'selectableCount': sum(isinstance(d, dict) and d.get('selectable') is True for d in devices),
            'enabled': pref.get('enabled') is True, 'savedNode': node(pref.get('node')),
            'savedNodePresent': any(isinstance(d, dict) and d.get('node') == pref.get('node') for d in devices),
            'mode': policy.get('mode') if policy.get('mode') in ('off', 'observe', 'filter', 'grab') else None,
            'connected': policy.get('connected') is True, 'activeNode': node(policy.get('node')),
            'homeReady': home.get('ready') is True, 'homeListening': home.get('listening') is True,
            'errorCategory': category(data.get('error') or state.get('error') or home.get('error'))}


INPUT_LOG_COMMAND = 'if [ -f /tmp/vetro-input.log ]; then tail -c 8192 /tmp/vetro-input.log | tail -n 8; fi'


def input_log_summary(result):
    output = result.get('output', '') if isinstance(result, dict) else ''
    records = []
    for line in str(output)[-8192:].splitlines()[-8:]:
        grab = re.search(r'EVIOCGRAB (/dev/input/event[0-9]{1,4}) failed with errno ([0-9]{1,3})', line)
        exception = re.search(r'\b([A-Za-z]{1,40}Exception)\b', line)
        if grab:
            records.append({'kind': 'grab_failed', 'node': grab[1], 'errno': int(grab[2])})
        elif '[GC_INFO]' in line:
            records.append({'kind': 'runtime_gc'})
        elif exception:
            records.append({'kind': 'exception', 'type': exception[1]})
        else:
            records.append({'kind': 'other', 'characters': len(line)})
    return {'execExitCode': result.get('exit_code') if isinstance(result, dict) else None, 'lines': records}


def collect(owner, clock=time.monotonic):
    report = {'schema': 1, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'targetAppId': TARGET, 'readOnly': True, 'sections': {}}
    def read(name, route, transform, body=None):
        started = clock()
        try:
            result = owner.request(route, body, timeout=40)
            report['sections'][name] = {'ok': True, 'data': transform(result)}
        except Exception as error:
            report['sections'][name] = {'ok': False, 'errorType': type(error).__name__,
                                        'httpStatus': getattr(error, 'code', None) if type(getattr(error, 'code', None)) is int else None}
        report['sections'][name]['elapsedSeconds'] = round(max(0, clock() - started), 3)
    def status(data):
        self_info = data.get('self') or {}
        agent = data.get('agent') or {}
        build = data.get('app') or data.get('connectionDiagnostics') or {}
        revision = build.get('sourceRevision')
        return {'serviceUid': self_info.get('uid') if type(self_info.get('uid')) is int else None,
                'servicePid': self_info.get('pid') if type(self_info.get('pid')) is int else None,
                'rootConnected': agent.get('connected') is True,
                'sourceRevision': revision if isinstance(revision, str) and re.fullmatch(r'[a-f0-9]{40}', revision) else None,
                'sourceDirty': build.get('sourceDirty') if type(build.get('sourceDirty')) is bool else None}
    def access(data):
        events = data.get('events') if isinstance(data.get('events'), list) else []
        return {'enabled': data.get('enabled') is True, 'available': data.get('available') is True,
                'hasError': bool(data.get('error')), 'pendingCount': len(data.get('pending') or []),
                'grantCount': len(data.get('grants') or []),
                'targetEvents': [{'method': e.get('method') if e.get('method') in ('access.request', 'access.status', 'apps.list', 'apps.launch') else 'other',
                                  'outcome': e.get('outcome') if e.get('outcome') in ('unavailable', 'not_allowed', 'pending', 'completed', 'permission_denied', 'disabled', 'busy', 'identity_changed') else 'other'}
                                 for e in events if isinstance(e, dict) and e.get('appId') == TARGET][:8]}
    read('status', '/status', status)
    read('permissions', '/app-access', access)
    uid = report['sections'].get('status', {}).get('data', {}).get('serviceUid')
    if type(uid) is int and 0 <= uid <= 2147483647:
        read('registry', '/exec', parse_registry, {'cmd': registry_command(uid)})
    else:
        report['sections']['registry'] = {'ok': False, 'errorType': 'ServiceUidUnavailable'}
    read('input', '/input', limited_input)
    read('inputLog', '/exec', input_log_summary, {'cmd': INPUT_LOG_COMMAND})
    pid = report['sections'].get('status', {}).get('data', {}).get('servicePid')
    if app_access_input_audit is not None and type(pid) is int and pid > 0:
        read('inputProcesses', '/exec', app_access_input_audit.summarize, {'cmd': app_access_input_audit.command(pid)})
    else:
        report['sections']['inputProcesses'] = {'ok': False, 'errorType': 'AuditUnavailable'}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', type=Path, required=True)
    parser.add_argument('--tv', default='192.168.84.19')
    parser.add_argument('--port', type=int, default=8099)
    parser.add_argument('--report-host', default='pedro@192.168.84.2')
    args = parser.parse_args()
    address = ipaddress.IPv4Address(args.tv)
    if not args.project_root.is_dir() or not 1 <= args.port <= 65535 or not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+', args.report_host):
        parser.error('Use the existing project folder, a valid port and user@host for report retrieval')
    directory = args.project_root.resolve() / 'vetro-install'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    output = directory / 'access-diagnostics' / ('app-access-' + stamp + '.json')
    print('=== Vetro app access diagnostic START ===')
    try:
        owner = OwnerClient('http://' + str(address) + ':' + str(args.port), directory / 'combined-updates')
        report = collect(owner)
    except Exception as error:
        report = {'schema': 1, 'readOnly': True, 'errorType': type(error).__name__}
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x', encoding='utf-8') as stream:
            json.dump(report, stream, indent=2)
            stream.write('\n')
        print('Report: ' + str(output))
        print('Run this on your Mac to retrieve the report:')
        print('rsync -P ' + shlex.quote(args.report_host + ':' + str(output)) + ' ~/Downloads/')
    finally:
        print('=== Vetro app access diagnostic END ===')


if __name__ == '__main__':
    main()
