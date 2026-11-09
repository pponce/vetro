#!/usr/bin/env python3
"""Install the tested enhanced Vetro package with direct physical Home input."""
import importlib.util
from pathlib import Path


def updater_module():
    spec = importlib.util.spec_from_file_location(
        'vetro_direct_home_updater', Path(__file__).with_name('update-home-suite.py'))
    suite = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(suite)
    suite.__doc__ = __doc__
    vetro = dict(next(app for app in suite.APPS if app['key'] == 'vetro'))
    vetro.update(
        revision='a5055f2216ba3dbdcef2b089c9bc4e04b337a089',
        run=42537866728,
        artifact=13639913528,
        digest='93df73f413cc837033429738e7ff982fc823dd7af2eedafe20e949118783d84e')
    vetro['required'] = vetro['required'] + [
        'payload/SamsungTvRemoteInputAgent.dll',
        'payload/SamsungTvRemoteInputAgent.deps.json',
        'payload/SamsungTvRemoteInputAgent.runtimeconfig.json']
    suite.APPS = [vetro]
    suite.SUITE = 'vetro-direct-home-20261109-r1'
    base = suite.Updater

    class DirectHomeUpdater(base):
        def execute(self):
            super().execute()
            if not self.args.check_only:
                self.check_direct_home()

        def check_direct_home(self):
            # Report only readiness fields, never the input event history.
            result = {'hardwareTested': False}
            self.report['directHome'] = result
            try:
                dock = self.owner.request('/dock', timeout=30)
                response = self.owner.request('/input', timeout=30)
                status = response.get('status', {})
                policy = status.get('policy', {})
                result.update(
                    launcherConfigured=dock.get('enabled') is True or bool(dock.get('customApp')),
                    launcherRunning=dock.get('running') is True,
                    interceptionSaved=status.get('preference', {}).get('enabled') is True,
                    filterConnected=policy.get('mode') == 'filter' and policy.get('connected') is True,
                    fifoPresent=self.remote(
                        'if test -p /home/owner/tvlauncher-home.fifo; then printf present; else printf absent; fi') == 'present')
                result['readyForTest'] = all(result[k] for k in (
                    'launcherConfigured', 'launcherRunning', 'interceptionSaved', 'filterConnected', 'fifoPresent'))
            except Exception as error:
                result['probeErrorType'] = type(error).__name__
                result['readyForTest'] = False
            if result['readyForTest']:
                print('READY: direct Home input is connected. Visual behavior still needs a remote test.', flush=True)
            else:
                print('INSTALLED: direct Home input is not yet confirmed ready.', flush=True)
                print('In Launcher, select Vetro. In Remapper, select your physical remote and enable interception. No separate Home shortcut rule is needed.', flush=True)
                print('Rerun this same script to check readiness; the recorded installation will not be repeated.', flush=True)
            print('Test Home once from Apple TV, a fast double press, and the Samsung Home tile. Report whether Samsung Home flashes before Vetro.', flush=True)

    suite.Updater = DirectHomeUpdater
    return suite


if __name__ == '__main__':
    raise SystemExit(updater_module().main())
