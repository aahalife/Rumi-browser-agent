"""Runs the real hosted browser agent against isolated persisted fictional records."""
import asyncio
import json
import os
import sys
import httpx
import websockets
from websockets.exceptions import InvalidStatus
from playwright.async_api import async_playwright
from pathlib import Path
from .client import FakePhone
BRIDGE_JS = (Path(__file__).resolve().parents[3] / 'ios/Linden/agent-bridge.js').read_text()


class HostedPhone(FakePhone):
    def __init__(self):
        super().__init__(base_url=os.environ.get('LINDEN_WEB_ORIGIN', 'https://3pxarh5thg13j2zk4f873-web-linden-portal.rork.live'), demo_key=os.environ['DEMO_ACCESS_CODE'])
        self.backend = 'https://care-pilot-backend.rork.app'

    async def __aenter__(self):
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch()
        context = await self._browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='America/Los_Angeles')
        await context.add_init_script(BRIDGE_JS)
        for path in ['/demo/test', '/demo/access']:
            for attempt in range(3):
                r = await context.request.post(self.base_url + '/~api' + path, headers={'X-Demo-Key': self.demo_key}, data={})
                if r.status != 503: break
                print(json.dumps({'connection_retry': path, 'attempt': attempt + 1, 'status': 503}), flush=True)
                await asyncio.sleep(attempt + 1)
            assert r.status == 200, ('isolated setup', path, r.status)
        self.page = await context.new_page()
        await self.page.goto(self.base_url + '/portal/login', wait_until='domcontentloaded')
        return self

    async def api(self, path, method='GET', body=None):
        r = await self.page.context.request.fetch(self.base_url + '/~api/portal/api' + path, method=method, data=body if body is not None else ({} if method != 'GET' else None))
        assert r.ok, ('portal API', path, r.status)
        return await r.json()

    async def login(self, username='demo', password='demo123'):
        await self.page.get_by_label('Username', exact=True).fill(username)
        await self.page.get_by_label('Password', exact=True).fill(password)
        await self.page.get_by_role('button', name='Sign in', exact=True).click()
        await self.page.wait_for_url('**/portal/home', timeout=15000)
        self.device_token = (await self.api('/auth/device-token', 'POST'))['token']
        await self.settle()

    async def restore_session(self):
        if not self.device_token:
            raise RuntimeError('No saved sign-in. Ask the patient to sign in.')
        code = (await self.api('/auth/device-login', 'POST', {'token': self.device_token}))['code']
        await self.page.goto(self.base_url + '/~api/portal/api/auth/device-login/complete?code=' + code + '&next=/portal/home', wait_until='domcontentloaded')

    async def logout_silently(self):
        await self.api('/auth/logout', 'POST')
        await self.goto('/portal/login')

    async def do_action(self, action, args):
        if action == 'click':
            try:
                await self.page.evaluate('([ref, expected]) => window.agentBridge.click(ref, expected)', [args['ref'], args.get('expected_page')])
                await self.settle()
                return True, None
            except Exception:
                return False, 'Click refused or interrupted'
        return await super().do_action(action, args)

    async def stop(self):
        await self.page.evaluate('() => window.agentBridge.stop()')
        await super().stop()

    async def connect(self):
        for attempt in range(3):
            async with httpx.AsyncClient(timeout=20) as http:
                r = await http.post(self.backend + '/agent/sessions', headers={'X-Demo-Key': self.demo_key}, json={})
            if r.status_code != 503: break
            print(json.dumps({'connection_retry': 'agent-session', 'attempt': attempt + 1, 'status': 503}), flush=True)
            await asyncio.sleep(attempt + 1)
        assert r.status_code == 200, ('agent session', r.status_code)
        created = r.json()
        self.session_id = created['session_id']
        for attempt in range(3):
            try:
                self._ws = await websockets.connect(self.backend.replace('https:', 'wss:') + '/agent/ws?session_id=' + self.session_id, additional_headers={'X-Agent-Token': created['session_token']}, max_size=3000000)
                return self.session_id
            except InvalidStatus as error:
                status = error.response.status_code
                if status != 503 or attempt == 2: raise
                print(json.dumps({'connection_retry': 'websocket-handshake', 'attempt': attempt + 1, 'status': status}), flush=True)
                await asyncio.sleep(attempt + 1)
        raise RuntimeError('Connection failed before any task was sent')


async def main():
    task = sys.argv[1] if len(sys.argv) > 1 else 'When is my next appointment?'
    async with HostedPhone() as phone:
        await phone.login()
        before = await phone.api('/appointments')
        await phone.connect()
        def event(msg):
            if msg['type'] in ('status', 'action_request', 'confirm_request', 'error'):
                # Only protocol types, actions and step counts; no credentials or page records.
                print(json.dumps({'event': msg['type'], 'step': msg.get('step'), 'action': msg.get('action')}), flush=True)
        outcome = await phone.run_task(task, confirm=lambda _: (True, None), on_event=event, timeout=180)
        nudges = 0
        while outcome['state'] == 'waiting_for_user' and task == 'Book a follow-up with Dr. Rao next week, afternoon if possible.' and nudges < 2:
            nudges += 1
            outcome = await phone.run_task('Yes, book an additional visit. Keep my existing appointment. Choose the first afternoon slot next week and show the approval sheet.', confirm=lambda _: (True, None), on_event=event, timeout=180)
        after = await phone.api('/appointments')
        print(json.dumps({'state': outcome['state'], 'summary': outcome.get('summary'), 'question': outcome.get('question'), 'steps': outcome['steps'], 'approvals': len(outcome['confirms']), 'appointments_before': len(before), 'appointments_after': len(after)}), flush=True)
        assert outcome['state'] == 'done', outcome['state']
        if task == 'Book a follow-up with Dr. Rao next week, afternoon if possible.':
            added = [a for a in after if a['id'] not in {b['id'] for b in before}]
            assert len(added) == 1 and added[0]['provider']['id'] == 1
            assert int(added[0]['start'][11:13]) >= 12 and outcome['confirms']
        if task == 'When is my next appointment?':
            assert before == after
            assert 'Rao' in outcome['summary']


if __name__ == '__main__':
    asyncio.run(main())
