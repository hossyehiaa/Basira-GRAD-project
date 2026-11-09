# -*- coding: utf-8 -*-
"""Render the two AgriWatch diagrams to PNG via Playwright."""
import asyncio
import os
from playwright.async_api import async_playwright

DIR = '/home/z/my-project/scripts/diagrams'
OUT = '/home/z/my-project/download'
os.makedirs(OUT, exist_ok=True)

JOBS = [
    (f'{DIR}/pipeline.html', f'{OUT}/مخطط_خط_المعالجة_AgriWatch.png', 1000),
    (f'{DIR}/architecture.html', f'{OUT}/مخطط_معمارية_الموقع_المستقل.png', 1120),
]

async def render(html_path, output_path, width):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(
            viewport={'width': width, 'height': 900},
            device_scale_factor=2)
        await page.goto(f'file://{html_path}', wait_until='networkidle')
        await page.wait_for_timeout(600)
        el = page.locator('#root')
        bbox = await el.bounding_box()
        if bbox:
            await page.set_viewport_size({
                'width': max(width, int(bbox['width'] + 60)),
                'height': int(bbox['height'] + 60)})
            await page.wait_for_timeout(300)
        await el.screenshot(path=output_path)
        await browser.close()
        print('OK:', output_path, f'{os.path.getsize(output_path)/1024:.0f}KB')

async def main():
    for html, out, w in JOBS:
        await render(html, out, w)

asyncio.run(main())
