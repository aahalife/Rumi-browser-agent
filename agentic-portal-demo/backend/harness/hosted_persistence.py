"""Keep an isolated authenticated browser alive across a real backend version change."""
import asyncio
import time
import httpx
from .hosted_agent import HostedPhone


async def main():
    async with HostedPhone() as phone:
        await phone.login()
        thread = await phone.api('/messages', 'POST', {
            'recipient_id': 1,
            'subject': 'Isolated redeployment persistence check',
            'body': 'This fictional message must survive the backend update.',
        })
        expected = await phone.api('/messages/' + str(thread['id']))
        async with httpx.AsyncClient(timeout=15) as http:
            response = await http.get(phone.backend + '/healthz')
            response.raise_for_status()
            before = response.json()['version']
            print('READY: isolated record, portal session, and device credential established; baseline version', before, flush=True)
            deadline = time.monotonic() + 180
            changed = False
            while time.monotonic() < deadline:
                await asyncio.sleep(3)
                response = await http.get(phone.backend + '/healthz')
                if response.status_code == 200 and response.json()['version'] != before:
                    changed = True
                    break
            assert changed, 'No actual backend version change observed before timeout'
        assert (await phone.api('/me'))['username'] == 'demo'
        assert await phone.api('/messages/' + str(thread['id'])) == expected
        await phone.logout_silently()
        await phone.restore_session()
        assert (await phone.api('/me'))['username'] == 'demo'
        assert await phone.api('/messages/' + str(thread['id'])) == expected
        print('PASS: record, authenticated portal session, and saved-device restoration survived a real redeployment', flush=True)


if __name__ == '__main__':
    asyncio.run(main())
