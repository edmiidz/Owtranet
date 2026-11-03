// Test page logic split out to ensure functions are in scope when buttons are clicked

function simulateContextDetection() {
  const context = {
    type: 'monitoring',
    platform: 'test-dashboard',
    hasMetrics: true,
    hasAlerts: true,
  };

  document.getElementById('context-result').innerHTML = `
    <strong>Detected Context:</strong><br>
    Type: ${context.type}<br>
    Platform: ${context.platform}<br>
    Has Metrics: ${context.hasMetrics}<br>
    Has Alerts: ${context.hasAlerts}
  `;
  document.getElementById('context-result').className = 'result success';
}

function testFormValidation() {
  const result = document.getElementById('validation-result');

  try {
    const titleTests = [
      { title: '', expected: false, description: 'Empty title' },
      { title: 'A', expected: false, description: 'Too short title' },
      { title: 'Valid Title', expected: true, description: 'Valid title' },
      { title: 'A'.repeat(201), expected: false, description: 'Too long title' },
    ];

    const contentTests = [
      { content: '', expected: false, description: 'Empty content' },
      { content: 'Short', expected: false, description: 'Too short content' },
      { content: 'Valid content with enough characters', expected: true, description: 'Valid content' },
    ];

    let results = '<strong>Validation Results:</strong><br>';

    titleTests.forEach((test) => {
      const isValid = test.title.length >= 5 && test.title.length <= 200;
      const status = isValid === test.expected ? '✅' : '❌';
      results += `${status} ${test.description}: ${isValid}<br>`;
    });

    contentTests.forEach((test) => {
      const isValid = test.content.length >= 10 && test.content.length <= 10000;
      const status = isValid === test.expected ? '✅' : '❌';
      results += `${status} ${test.description}: ${isValid}<br>`;
    });

    result.innerHTML = results;
    result.className = 'result success';
  } catch (error) {
    result.innerHTML = `❌ Error: ${error.message}`;
    result.className = 'result error';
  }
}

function testAPIConnection() {
  const result = document.getElementById('api-result');
  result.innerHTML = 'Testing API connection...';
  result.className = 'result info';

  if (!(window.chrome && chrome.runtime && chrome.runtime.sendMessage)) {
    result.innerHTML = '❌ This test must run as an extension page. Open it from the extension Options.';
    result.className = 'result error';
    return;
  }

  const API_URL = 'https://intranet.example.com/api/v1/forum/posts';
  let finished = false;

  // Fallback: direct GET from options page after 4s
  const fallbackTimer = setTimeout(async () => {
    if (finished) return;
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort('timeout'), 6000);
      const resp = await fetch(API_URL, { method: 'GET', signal: controller.signal });
      clearTimeout(id);
      const text = await resp.text().catch(() => '');
      finished = true;
      if (resp.ok) {
        result.innerHTML = `✅ API reachable (direct GET). Status: ${resp.status}`;
        result.className = 'result success';
      } else {
        result.innerHTML = `⚠️ API reachable (direct GET) but HTTP ${resp.status}: ${resp.statusText}<br><pre>${text.slice(0, 2000)}</pre>`;
        result.className = 'result success';
      }
    } catch (e) {
      if (finished) return;
      finished = true;
      result.innerHTML = `❌ Direct GET error: ${e && e.message ? e.message : e}`;
      result.className = 'result error';
    }
  }, 4000);

  try {
    console.log('[Test] Sending testConnection message');
    chrome.runtime.sendMessage({ action: 'testConnection' }, (response) => {
      console.log('[Test] Received response', response, chrome.runtime.lastError);
      if (finished) return;
      clearTimeout(fallbackTimer);
      finished = true;
      if (chrome.runtime.lastError) {
        result.innerHTML = `❌ Runtime Error: ${chrome.runtime.lastError.message}`;
        result.className = 'result error';
        return;
      }

      if (response && response.success) {
        const details = [];
        if (response.status) details.push(`<strong>Status:</strong> ${response.status}`);
        if (response.message) details.push(`<strong>Message:</strong> ${response.message}`);
        if (response.response) details.push(`<strong>Body:</strong><br><pre>${response.response}</pre>`);
        result.innerHTML = `✅ API Check Completed<br>${details.join('<br>')}`;
        result.className = 'result success';
      } else {
        result.innerHTML = `❌ API Connection Error: ${(response && response.error) || 'Unknown error'}`;
        result.className = 'result error';
      }
    });
  } catch (error) {
    if (finished) return;
    clearTimeout(fallbackTimer);
    finished = true;
    result.innerHTML = `❌ API Connection Error: ${error.message}`;
    result.className = 'result error';
  }
}

function testTemplates() {
  const result = document.getElementById('template-result');

  const templates = {
    alert: {
      title: '🚨 Alert - ',
      content: '## Alert Details\n\n**Type**: \n**Severity**: \n**Description**: \n\n**Action Required**: \n\n**Status**: \n\n---\n*Posted via Chrome Extension*',
      tags: 'alert, monitoring',
      priority: 'high',
    },
    deployment: {
      title: '🚀 Deployment - ',
      content: '## Deployment Summary\n\n**Environment**: \n**Version**: \n**Changes**: \n\n**Status**: \n**Deployed By**: \n\n**Rollback Plan**: \n\n---\n*Posted via Chrome Extension*',
      tags: 'deployment, release',
      priority: 'normal',
    },
  };

  let results = '<strong>Available Templates:</strong><br>';

  Object.entries(templates).forEach(([key, template]) => {
    results += `<br><strong>${key.toUpperCase()}:</strong><br>`;
    results += `Title: ${template.title}<br>`;
    results += `Priority: ${template.priority}<br>`;
    results += `Tags: ${template.tags}<br>`;
  });

  result.innerHTML = results;
  result.className = 'result success';
}

function testStorage() {
  const result = document.getElementById('storage-result');

  try {
    const testData = {
      testKey: 'testValue',
      timestamp: new Date().toISOString(),
    };

    localStorage.setItem('owtranet_test', JSON.stringify(testData));
    const retrieved = JSON.parse(localStorage.getItem('owtranet_test'));

    if (retrieved && retrieved.testKey === 'testValue') {
      result.innerHTML = `✅ Storage Test Successful!<br><strong>Stored:</strong> ${JSON.stringify(testData)}<br><strong>Retrieved:</strong> ${JSON.stringify(retrieved)}`;
      result.className = 'result success';

      localStorage.removeItem('owtranet_test');
    } else {
      result.innerHTML = '❌ Storage Test Failed - Data mismatch';
      result.className = 'result error';
    }
  } catch (error) {
    result.innerHTML = `❌ Storage Test Error: ${error.message}`;
    result.className = 'result error';
  }
}

// Wire up buttons after DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(simulateContextDetection, 500);
  document.title = 'Test Monitoring Dashboard - New Relic';

  const dashboardContent = document.createElement('div');
  dashboardContent.innerHTML = `
    <div class="test-section">
      <h2>📊 Simulated Monitoring Dashboard</h2>
      <p>This simulates a monitoring dashboard to test the extension's context detection.</p>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px;">
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center;">
          <h3>CPU Usage</h3>
          <div style="font-size: 2em; color: #28a745;">78%</div>
          <div style="color: #6c757d;">Normal</div>
        </div>
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center;">
          <h3>Memory Usage</h3>
          <div style="font-size: 2em; color: #ffc107;">65%</div>
          <div style="color: #6c757d;">Warning</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(dashboardContent);

  document.getElementById('btn-test-validation').addEventListener('click', testFormValidation);
  document.getElementById('btn-test-api').addEventListener('click', testAPIConnection);
  document.getElementById('btn-test-templates').addEventListener('click', testTemplates);
  document.getElementById('btn-test-storage').addEventListener('click', testStorage);
});
