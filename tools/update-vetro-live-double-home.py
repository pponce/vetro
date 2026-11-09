#!/usr/bin/env python3
"""Install enhanced Vetro with confirmed live double-press settings."""
import importlib.util
import json
import urllib.error
from pathlib import Path


def updater_module():
    spec = importlib.util.spec_from_file_location('vetro_live_double_home_updater', Path(__file__).with_name('update-home-suite.py'))
    suite = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(suite)
    suite.__doc__ = __doc__
    vetro = dict(next(app for app in suite.APPS if app['key'] == 'vetro'))
    vetro.update(revision='1768e251784adb14dc007052c5b9a45e567e2777',
                 run=42550258938, artifact=13644104863, digest='9945da1734b88d507fdbc8eba28656c9582b86df60eba49ce33f6fad79e0743d')
    vetro['required'] = vetro['required'] + [
        'payload/SamsungTvRemoteInputAgent.dll',
        'payload/SamsungTvRemoteInputAgent.deps.json',
        'payload/SamsungTvRemoteInputAgent.runtimeconfig.json']
    suite.APPS = [vetro]
    suite.SUITE = 'vetro-live-double-home-20261109-r2'
    base = suite.Updater

    class LiveDoubleHomeUpdater(base):
        def refresh_native(self, record):
            dock = self.owner.request('/dock', timeout=30)
            if dock.get('busy'):
                raise suite.Stop('The launcher is busy. Let the dashboard action finish, then rerun this installer.')
            if 'nativeRefreshPlan' not in record:
                record['nativeRefreshPlan'] = {key: dock.get(key) for key in
                    ('enabled', 'customApp', 'doubleHome', 'homeShortcut')}
                self.save()
            plan = record['nativeRefreshPlan']
            if record.get('nativeRefreshVerified'):
                # Once installation completed, honor settings the owner changed later.
                plan = {key: dock.get(key) for key in ('enabled', 'customApp', 'doubleHome', 'homeShortcut')}
            if not plan.get('enabled') and not plan.get('customApp'):
                record['nativeRefresh'] = 'not-active'
                record['liveDoubleHome'] = 'available-on-next-launch'
                self.save()
                return True

            # Loading a new native binary needs one stop/start. Use the public
            # controls in separate confirmed steps, retaining the saved mode.
            # A rerun inspects an unresolved step before attempting any next step.
            if not record.get('nativeStopConfirmed'):
                if not record.get('nativeStopSubmitted'):
                    record['nativeStopSubmitted'] = True
                    self.save()
                    print('Stopping the Home launcher once to load the updated native binary...', flush=True)
                    dock = self.owner.request('/dock', {'action': 'disableCustom' if plan.get('customApp') else 'disable'}, timeout=60)
                if dock.get('enabled') or dock.get('customApp') or dock.get('running') is not False:
                    raise suite.Stop('The launcher stop is not confirmed. Return the report; the stop will not be blindly repeated.')
                record['nativeStopConfirmed'] = True
                self.save()

            if not record.get('nativeStartConfirmed'):
                already_running = (dock.get('running') is True and dock.get('enabled') == plan.get('enabled')
                                   and dock.get('customApp') == plan.get('customApp'))
                if not already_running and not record.get('nativeStartSubmitted'):
                    if dock.get('enabled') or dock.get('customApp') or dock.get('running') is not False:
                        raise suite.Stop('The Home state changed before the launcher start. Return the report.')
                    record['nativeStartSubmitted'] = True
                    self.save()
                    print('Starting the updated launcher with the saved Home settings...', flush=True)
                    action = {'action': 'enableCustom', 'appId': plan['customApp']} if plan.get('customApp') else {'action': 'enable'}
                    dock = self.owner.request('/dock', action, timeout=90)
                if (dock.get('running') is not True or dock.get('enabled') != plan.get('enabled')
                        or dock.get('customApp') != plan.get('customApp')):
                    raise suite.Stop('The launcher start is not confirmed. Return the report; a rerun checks this start without repeating it.')
                record['nativeStartConfirmed'] = True
                self.save()

            if any(dock.get(key) != plan.get(key) for key in ('enabled', 'customApp', 'doubleHome', 'homeShortcut')):
                raise suite.Stop('The current Home settings differ from the installation plan. Return the report before changing them.')
            if dock.get('running') is not True:
                raise suite.Stop('The updated launcher is not running. Return the report.')
            if plan.get('enabled'):
                before_pid = dock.get('pid')
                if not isinstance(before_pid, int) or before_pid <= 0:
                    raise suite.Stop('The native launcher process could not be identified.')
                print('Checking a live save of the existing double-press setting...', flush=True)
                try:
                    after = self.owner.request('/dock', {'action': 'doubleHome', 'value': plan['doubleHome']}, timeout=45)
                except urllib.error.HTTPError as error:
                    detail = 'HTTP ' + str(error.code)
                    try:
                        response = json.loads(error.read(8192))
                        if isinstance(response.get('error'), str):
                            detail += ': ' + response['error'][:1500]
                    except (ValueError, AttributeError):
                        pass
                    record['liveDoubleHome'] = {'savedAndApplied': False, 'error': detail}
                    self.save()
                    raise suite.Stop('Live-save verification failed. ' + detail) from None
                verified = (after.get('running') is True and after.get('pid') == before_pid
                            and all(after.get(key) == plan.get(key) for key in ('enabled', 'customApp', 'doubleHome', 'homeShortcut')))
                record['liveDoubleHome'] = {'sameProcess': after.get('pid') == before_pid, 'savedAndApplied': verified}
                if not verified:
                    self.save()
                    raise suite.Stop('The live save did not confirm the same running launcher and settings. Return the report.')
                print('VERIFIED: double-press settings saved and applied without restarting the launcher.', flush=True)
            else:
                record['liveDoubleHome'] = 'inactive-in-custom-mode'
            record['nativeRefreshVerified'] = True
            self.save()
            return True

    suite.Updater = LiveDoubleHomeUpdater
    return suite


if __name__ == '__main__':
    raise SystemExit(updater_module().main())
