"""Use Vetro's temporary observation mode while replacing its package."""
import base64
import json
import re
import time

import app_access_input_audit as audit


def input_summary(value):
    status = value.get('status') or {}
    policy = status.get('policy') or {}
    return {'mode': policy.get('mode') if policy.get('mode') in ('off', 'observe', 'filter') else None,
            'connected': policy.get('connected') is True,
            'savedEnabled': (status.get('preference') or {}).get('enabled') is True,
            'homeReady': (value.get('home') or {}).get('ready') is True}


def release_command(pid, started):
    if type(pid) is not int or not 1 <= pid <= 2147483647 or type(started) is not int or started <= 0:
        raise ValueError('A verified helper PID and start time are required')
    # A missing directory or a different start time proves this exact process
    # has ended. An unreadable stat file is not treated as successful release.
    script = '''if [ ! -d /proc/PID ]; then printf 'gone';
elif [ -r /proc/PID/stat ]; then
  vetro_update_start=$(awk '{sub(/^.*[)] /,"");split($0,f," ");print f[20]}' /proc/PID/stat 2>/dev/null)
  case "$vetro_update_start" in
    STARTED) printf 'alive';;
    ''|*[!0-9]*) if [ ! -d /proc/PID ]; then printf 'gone'; else printf 'unreadable'; fi;;
    *) printf 'reused';;
  esac
else printf 'unreadable'; fi'''.replace('PID', str(pid)).replace('STARTED', str(started))
    encoded = base64.b64encode(script.encode()).decode('ascii')
    return 'printf %s ' + encoded + ' | base64 -d | sh'


class InputHandoff:
    def __init__(self, owner, record=None, save=None, clock=time.monotonic, pause=time.sleep):
        self.owner = owner
        self.record = record if record is not None else {'schema': 1}
        self.save = save or (lambda record: None)
        self.clock, self.pause = clock, pause

    def checkpoint(self):
        self.save(self.record)

    def service(self, revision):
        data = self.owner.raw('/status', timeout=8)
        build, agent = data.get('app') or {}, data.get('agent') or {}
        pid = (data.get('self') or {}).get('pid')
        if build.get('sourceRevision') != revision or build.get('sourceDirty') is not False or agent.get('connected') is not True:
            raise RuntimeError('Input handoff requires the expected clean service and connected root agent')
        if type(pid) is not int or pid <= 0:
            raise RuntimeError('Current service PID is unavailable')
        return pid

    def begin(self, revision):
        pid = self.service(revision)
        data = self.owner.raw('/input', timeout=15)
        before = input_summary(data)
        self.record['before'] = before
        process_data = audit.summarize(self.owner.raw('/exec', {'cmd': audit.command(pid)}, timeout=40))
        if not process_data.get('complete'):
            raise RuntimeError('Input process evidence is incomplete; no installation submitted')
        filters = [h for h in process_data['helpers'] if h.get('mode') == 'filter']
        if before['mode'] == 'off' and not before['savedEnabled'] and not filters:
            self.record.update(required=False, verified=True)
            self.checkpoint()
            return
        policy = (data.get('status') or {}).get('policy') or {}
        node = policy.get('node')
        if before['mode'] != 'filter' or not before['connected'] or not isinstance(node, str) or not re.fullmatch(r'/dev/input/event[0-9]{1,6}', node):
            raise RuntimeError('Saved remote input is not currently connected; no installation submitted')
        if len(filters) != 1 or filters[0].get('node') != node or filters[0].get('currentServiceConnectionObserved') is not True:
            raise RuntimeError('Could not verify one filtering helper owned by the current service; no installation submitted')
        helper = filters[0]
        process = next((p for p in process_data['processes'] if p.get('pid') == helper['pid']), {})
        started = process.get('startTicks')
        probe = release_command(helper['pid'], started)
        preference = json.dumps((data.get('status') or {}).get('preference'), sort_keys=True)
        self.record.update(required=True, verified=False, observationRequested=True,
                           observationConfirmed=False, oldFilterExited=False, resumeRequested=False,
                           oldHelper={'pid': helper['pid'], 'startTicks': started})
        self.checkpoint()
        print('Temporarily listening without intercepting remote keys; saved mappings stay in place...', flush=True)
        answer = self.owner.raw('/input', {'mode': 'observe', 'device': node}, timeout=40)
        observed = self.owner.raw('/input', timeout=15)
        current = input_summary(observed)
        if answer.get('ok') is not True or current['mode'] != 'observe' or not current['connected']:
            raise RuntimeError('Temporary input observation was not confirmed; no installation submitted')
        if json.dumps((observed.get('status') or {}).get('preference'), sort_keys=True) != preference:
            raise RuntimeError('Saved input preference changed during handoff; no installation submitted')
        deadline = self.clock() + 15
        while self.clock() < deadline:
            result = self.owner.raw('/exec', {'cmd': probe}, timeout=8)
            state = result.get('output', '').strip()
            if result.get('exit_code') != 0 or result.get('timed_out') or state not in ('gone', 'reused', 'alive', 'unreadable'):
                raise RuntimeError('Old input helper release could not be checked; no installation submitted')
            if state in ('gone', 'reused'):
                self.record.update(observationConfirmed=True, oldFilterExited=True)
                self.checkpoint()
                print('VERIFIED: the previous filtering helper has exited.', flush=True)
                return
            if state == 'unreadable':
                raise RuntimeError('Old input helper state is unreadable; no installation submitted')
            self.pause(0.5)
        raise RuntimeError('Previous filtering helper is still running; no installation submitted')

    def restore(self, revision):
        self.service(revision)
        before = self.record.get('before') or {}
        after = input_summary(self.owner.raw('/input', timeout=15))
        # A new service may have restored the saved filter already. Do not tear
        # down a working filter, or race an in-progress automatic connection.
        deadline = self.clock() + 20
        while after['mode'] == 'filter' and not after['connected'] and self.clock() < deadline:
            self.pause(1)
            after = input_summary(self.owner.raw('/input', timeout=15))
        if self.record.get('observationRequested') and after['mode'] != 'filter':
            print('Restoring the saved remote input and Home assignment...', flush=True)
            self.record['resumeRequested'] = True
            self.checkpoint()
            answer = self.owner.raw('/input', {'mode': 'resume'}, timeout=40)
            if answer.get('ok') is not True:
                raise RuntimeError('Saved remote input did not resume')
            after = input_summary(self.owner.raw('/input', timeout=15))
        self.record['after'] = after
        verified = (after['mode'] == 'filter' and after['connected'] and after['savedEnabled'] == before.get('savedEnabled') and
                    (not before.get('homeReady') or after['homeReady'])) if self.record.get('required') else after['mode'] == before.get('mode')
        self.record['verified'] = bool(verified)
        if verified:
            self.record['observationRequested'] = False
        self.checkpoint()
        if not verified:
            raise RuntimeError('Remote input restoration is not verified')
        print('VERIFIED: remote input matches the saved setup.', flush=True)
