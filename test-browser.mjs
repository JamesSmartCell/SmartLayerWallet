#!/usr/bin/env node
/**
 * Test production build in headless browser to verify no client-side errors
 */
import { chromium } from 'playwright';

async function test() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const errors = [];
  const warnings = [];
  
  // Capture console errors (filter out network/CORS errors)
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    // Ignore CORS and network errors (expected in test environment)
    const isNetworkError = text.includes('CORS policy') || 
                          text.includes('Failed to load resource') ||
                          text.includes('net::ERR_') ||
                          text.includes('429');
    if (type === 'error' && !isNetworkError) {
      errors.push(text);
      console.error(`Browser Console Error: ${text}`);
    } else if (type === 'warning') {
      warnings.push(text);
      console.warn(`Browser Console Warning: ${text}`);
    } else {
      console.log(`Browser Console [${type}]: ${text}`);
    }
  });
  
  // Capture page errors
  page.on('pageerror', error => {
    errors.push(error.message);
    console.error(`Page Error: ${error.message}`);
    console.error(error.stack);
  });
  
  try {
    console.log('Navigating to http://127.0.0.1:8089/...');
    await page.goto('http://127.0.0.1:8089/', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    console.log('Page loaded, waiting 2 seconds for React hydration...');
    await page.waitForTimeout(2000);
    
    // Check if page rendered
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    const h1 = await page.textContent('h1').catch(() => null);
    console.log(`H1 text: ${h1}`);
    
    // Take screenshot
    await page.screenshot({ path: '/tmp/page-screenshot.png' });
    console.log('Screenshot saved to /tmp/page-screenshot.png');
    
    console.log('\n=== Test Results ===');
    console.log(`Errors: ${errors.length}`);
    console.log(`Warnings: ${warnings.length}`);
    
    if (errors.length > 0) {
      console.error('\n❌ FAILED: Client-side errors detected:');
      errors.forEach(err => console.error(`  - ${err}`));
      process.exit(1);
    } else {
      console.log('\n✅ PASSED: No client-side errors detected!');
      console.log('Page rendered successfully.');
      process.exit(0);
    }
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    await page.screenshot({ path: '/tmp/error-screenshot.png' });
    console.error('Error screenshot saved to /tmp/error-screenshot.png');
    process.exit(1);
  } finally {
    await browser.close();
  }
}

test();
