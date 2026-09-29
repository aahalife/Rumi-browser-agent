"""Hosted redesign checks in an isolated workspace; screenshots contain fictional records only."""
import asyncio
from pathlib import Path
from .hosted_agent import HostedPhone


async def main():
    output = Path(__file__).resolve().parents[3] / '.rork'
    async with HostedPhone() as phone:
        errors = []
        phone.page.on('pageerror', lambda error: errors.append(str(error)))
        await phone.login()
        await phone.page.get_by_role('heading', name='Upcoming Office Visit').wait_for()
        await phone.page.get_by_role('link', name='View details', exact=True).wait_for()
        await phone.page.screenshot(path=str(output / 'rumi-portal-mobile.png'), full_page=True)
        assert await phone.page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        await phone.page.get_by_role('link', name='Billing', exact=True).click()
        await phone.page.get_by_role('button', name='View statement').click()
        assert await phone.page.get_by_text('Example insurance payment').is_visible()
        await phone.page.get_by_role('link', name='Home', exact=True).click()
        await phone.page.get_by_role('link', name='Video Visits', exact=True).click()
        await phone.page.get_by_label('Find a quiet, private space').check()
        assert await phone.page.get_by_role('status').inner_text() == '1 of 4 preparation steps complete'
        await phone.page.get_by_role('link', name='Home', exact=True).click()
        await phone.page.set_viewport_size({'width': 1024, 'height': 900})
        await phone.page.get_by_role('link', name='View details', exact=True).wait_for()
        await phone.page.screenshot(path=str(output / 'rumi-portal-wide.png'), full_page=True)
        assert await phone.page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        assert not errors, errors
        print('PASS: hosted mobile/wide layout, billing detail, video checklist, no page errors')


if __name__ == '__main__':
    asyncio.run(main())
