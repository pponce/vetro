#!/usr/bin/env python3
"""Update only enhanced Vetro with the Samsung Home launch fix."""
import importlib.util
from pathlib import Path


def updater_module():
    spec = importlib.util.spec_from_file_location('vetro_home_fix_updater',
                                                Path(__file__).with_name('update-home-suite.py'))
    suite = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(suite)
    suite.__doc__ = __doc__
    vetro = dict(next(app for app in suite.APPS if app['key'] == 'vetro'))
    vetro.update(
        revision='a57bf4cf4967620f158e750b7e37f0399efc4176',
        run=42523234818,
        artifact=13634208090,
        digest='372f4130a360c226c8dd0b3a8e69e955f48fa4918b90133341073034dfaf3bd1')
    suite.APPS = [vetro]
    # A distinct ledger prevents the previous suite's verified installation from
    # being mistaken for this update, while owner pairing is reused as before.
    suite.SUITE = 'vetro-home-fix-20261108-r1'
    return suite


if __name__ == '__main__':
    raise SystemExit(updater_module().main())
