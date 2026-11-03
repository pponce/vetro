"""Owner-paired Vetro HTTP client for local maintenance tools; no app credentials."""
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Vetro redirected the request; credentials were not forwarded')


class OwnerClient:
    def __init__(self, base, directory, log=print, prompt=None):
        self.base = base.rstrip('/')
        self.log = log
        self.prompt = prompt or (lambda: getpass.getpass('Six-digit code shown in Vetro on the TV: '))
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.file = Path(directory) / ('owner-' + hashlib.sha256(self.base.encode()).hexdigest()[:16] + '.json')
        self.token = os.environ.get('VETRO_TOKEN', '')
        if not self.token and self.file.exists():
            fd = os.open(self.file, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 1024:
                    raise RuntimeError('Owner credential file must be a private, user-owned regular file')
                with os.fdopen(fd, 'r', closefd=False) as stream:
                    self.token = json.load(stream).get('token', '')
            finally:
                os.close(fd)
        if self.token and not re.fullmatch(r'[a-f0-9]{64}', self.token):
            raise RuntimeError('Invalid owner credential; its value was not logged')

    def raw(self, route, body=None, timeout=40, authenticated=True):
        if not route.startswith('/') or route.startswith('//'):
            raise ValueError('Expected a local Vetro route')
        headers = {'Content-Type': 'application/json'}
        if authenticated and self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        request = urllib.request.Request(self.base + route, data=None if body is None else json.dumps(body).encode(), headers=headers)
        with self.opener.open(request, timeout=timeout) as response:
            data = response.read(4 * 1024 * 1024 + 1)
        if len(data) > 4 * 1024 * 1024:
            raise RuntimeError('Vetro response exceeded its limit')
        return json.loads(data)

    def pair(self):
        self.log('This Vetro requires owner pairing. Open Vetro on the TV and enter its displayed code here. The code and credential are not logged.')
        pending = self.raw('/auth/pair', {'name': 'Mint maintenance'}, authenticated=False)
        if not isinstance(pending, dict) or not re.fullmatch(r'[a-f0-9]{32}', pending.get('id', '')):
            raise RuntimeError('Vetro did not start a valid pairing request')
        for attempt in range(5):
            code = self.prompt().strip()
            if not re.fullmatch(r'\d{6}', code):
                raise RuntimeError('Enter the six-digit code shown on the TV, then rerun to resume verification')
            try:
                result = self.raw('/auth/confirm', {'id': pending['id'], 'code': code}, authenticated=False)
                break
            except urllib.error.HTTPError as error:
                if error.code != 403 or attempt == 4:
                    raise RuntimeError('Pairing was not confirmed. Wait for the code to expire, then rerun to resume verification') from None
                self.log('The TV refused that code. Check the current code on the TV.')
        token = result.get('token') if isinstance(result, dict) else None
        if not isinstance(token, str) or not re.fullmatch(r'[a-f0-9]{64}', token):
            raise RuntimeError('Vetro did not return a valid owner credential')
        self.file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, temporary = tempfile.mkstemp(prefix='.owner-', dir=self.file.parent)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump({'token': token}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.file)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        self.token = token
        self.log('Owner pairing saved for maintenance on this Mint account.')

    def request(self, route, body=None, timeout=40):
        try:
            return self.raw(route, body, timeout)
        except urllib.error.HTTPError as error:
            if error.code != 401:
                raise
        # Vetro rejects unauthenticated requests before dispatch. Only that
        # explicit response permits replay; never retry a timeout/disconnect.
        self.pair()
        return self.raw(route, body, timeout)
