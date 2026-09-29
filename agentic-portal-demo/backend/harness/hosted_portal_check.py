"""Hosted portal acceptance checks. Mutations are confined to signed isolated actors."""
import json
import os
from playwright.sync_api import sync_playwright

ORIGIN = os.environ.get('LINDEN_WEB_ORIGIN', 'https://3pxarh5thg13j2zk4f873-web-linden-portal.rork.live')
KEY = os.environ['DEMO_ACCESS_CODE']


def main():
    checks = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={'width': 390, 'height': 844}, timezone_id='America/Los_Angeles')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(type(error).__name__))
        # The setup request is authenticated, but no key is attached globally or to observations.
        response = context.request.post(ORIGIN + '/~api/demo/test', headers={'X-Demo-Key': KEY}, data={})
        assert response.status == 200, ('isolated setup', response.status)
        checks.append('isolated actor created')
        page.goto(ORIGIN + '/portal/', wait_until='domcontentloaded')
        page.get_by_label('Private access code').fill(KEY)
        page.get_by_role('button', name='Continue securely').click()
        page.get_by_label('Username', exact=True).wait_for(timeout=15000)
        page.get_by_label('Username', exact=True).fill('demo')
        page.get_by_label('Password', exact=True).fill('demo123')
        page.get_by_role('button', name='Sign in', exact=True).click()
        page.wait_for_url('**/portal/home', timeout=15000)
        checks.append('private access and patient login through hosted UI')

        def api(path, method='GET', body=None, expected=200):
            r = context.request.fetch(ORIGIN + '/~api/portal/api' + path, method=method, data=body if body is not None else ({} if method != 'GET' else None))
            assert r.status == expected, (path, r.status)
            return r.json()

        for route in ['home', 'visits', 'schedule', 'messages', 'results', 'medications', 'health-summary', 'care-team']:
            page.goto(ORIGIN + '/portal/' + route, wait_until='domcontentloaded')
            page.locator('h1').first.wait_for(timeout=15000)
            assert '/login' not in page.url
        checks.append('all eight hosted portal screens render')
        me = api('/me')
        assert me['first_name'] == 'Priya'
        appointments = api('/appointments')
        assert appointments[0]['start'][11:16] == '10:30'
        assert api('/results/1')['results'][0]['value'] == '5.9'
        assert api('/care-team') and api('/health-summary')['immunizations']
        checks.append('appointment wall time, results, care team, health summary')
        slots = api('/scheduling/slots?location_id=1&reason=follow_up&days=14')
        slot = next(s for s in slots if int(s['start'][11:13]) >= 12)
        booked = api('/appointments', 'POST', {'slot_id': slot['id'], 'reason': 'follow_up'}, 201)
        api('/appointments', 'POST', {'slot_id': slot['id'], 'reason': 'follow_up'}, 409)
        api('/appointments/' + str(booked['id']) + '/cancel', 'POST', {'reason': 'Scheduling conflict'})
        assert api('/appointments/' + str(booked['id']))['status'] == 'canceled'
        checks.append('afternoon booking, conflict rejection, cancellation')
        thread = api('/messages', 'POST', {'recipient_id': 1, 'subject': 'Isolated acceptance check', 'body': 'Test message.'}, 201)
        api('/messages/' + str(thread['id']) + '/reply', 'POST', {'body': 'Test reply.'}, 201)
        assert api('/messages/' + str(thread['id']))['message_count'] == 2
        api('/medications/1/refill', 'POST', {'pharmacy_id': 2}, 201)
        api('/medications/1/refill', 'POST', {'pharmacy_id': 2}, 409)
        assert api('/medications/1')['pending_refill']['pharmacy']['id'] == 2
        checks.append('message, reply, refill persistence and duplicate protection')
        base = '/appointments/' + str(appointments[0]['id']) + '/checkin'
        for step in ['personal_info', 'insurance', 'allergies', 'medications']:
            api(base + '/' + step, 'PUT', {'confirmed': True})
        api(base + '/questionnaire', 'PUT', {'answers': {'reason': 'Follow-up', 'new_symptoms': 'No', 'tobacco': 'No', 'falls': 'No'}})
        api(base + '/consent', 'PUT', {'agreed': True, 'signature': 'Priya Sharma'})
        assert api(base + '/complete', 'POST')['status'] == 'complete'
        checks.append('all check-in steps and consent persist')
        device = api('/auth/device-token', 'POST', {})
        api('/auth/logout', 'POST')
        code = api('/auth/device-login', 'POST', {'token': device['token']})['code']
        page.goto(ORIGIN + '/~api/portal/api/auth/device-login/complete?code=' + code + '&next=/portal/home', wait_until='domcontentloaded')
        assert page.url == ORIGIN + '/portal/home'
        assert api('/me')['id'] == me['id']
        api('/auth/device-login/revoke', 'POST', {'token': device['token']})
        api('/auth/device-login', 'POST', {'token': device['token']}, 401)
        api('/auth/refresh', 'POST')
        checks.append('saved-device restoration, safe redirect, revocation, refresh')
        api('/auth/logout', 'POST')
        api('/auth/login', 'POST', {'username': 'demo2', 'password': 'demo123'})
        api('/appointments/' + str(booked['id']), expected=404)
        api('/messages/' + str(thread['id']), expected=404)
        api('/medications/1', expected=404)
        checks.append('patient ownership enforced on hosted records')
        assert not errors, errors
        browser.close()
    print(json.dumps({'passed': checks, 'browser_errors': errors}))


if __name__ == '__main__':
    main()
