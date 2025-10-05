// api/follow.js
const https = require('https');

function httpsRequest(url, options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ 
        status: res.statusCode, 
        headers: res.headers, 
        body: data 
      }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function solveFunCaptcha(apiKey) {
  try {
    const createData = JSON.stringify({
      type: 'funcaptcha',
      sitekey: '476068BF-9607-4799-B53D-966BE98E2B81',
      url: 'https://www.roblox.com'
    });

    const createRes = await httpsRequest('https://api.nopecha.com/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    }, createData);

    const createResult = JSON.parse(createRes.body);
    
    if (!createResult.data || !createResult.data.task_id) {
      return { success: false, error: 'Failed to create CAPTCHA task' };
    }

    const taskId = createResult.data.task_id;

    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const resultRes = await httpsRequest(`https://api.nopecha.com/task/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      const resultData = JSON.parse(resultRes.body);

      if (resultData.data && resultData.data.status === 'completed') {
        return {
          success: true,
          token: resultData.data.solution,
          challengeId: resultData.data.challenge_id || '',
          metadata: resultData.data.metadata || ''
        };
      }

      if (resultData.data && resultData.data.status === 'failed') {
        return { success: false, error: 'CAPTCHA solving failed' };
      }
    }

    return { success: false, error: 'CAPTCHA solving timeout' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { cookie, targetUserId } = req.body;
    
    if (!cookie || !targetUserId) {
      return res.status(400).json({ 
        error: 'Missing required fields: cookie and targetUserId' 
      });
    }

    const csrfRes = await httpsRequest('https://auth.roblox.com/v1/authentication-ticket', {
      method: 'POST',
      headers: {
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'Referer': 'https://www.roblox.com/'
      }
    });

    const csrfToken = csrfRes.headers['x-csrf-token'];
    
    if (!csrfToken) {
      return res.status(401).json({ 
        error: 'Failed to get CSRF token. Cookie may be invalid.' 
      });
    }

    const followRes = await httpsRequest(`https://friends.roblox.com/v1/users/${targetUserId}/follow`, {
      method: 'POST',
      headers: {
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'X-CSRF-TOKEN': csrfToken,
        'Content-Type': 'application/json',
        'Referer': 'https://www.roblox.com/'
      }
    });

    const followData = followRes.body ? JSON.parse(followRes.body) : {};

    if (followRes.status === 403 && followData.errors) {
      const captchaError = followData.errors.find(e => 
        e.message && e.message.toLowerCase().includes('captcha')
      );
      
      if (captchaError) {
        const nopechaKey = process.env.NOPECHA_API_KEY;
        
        if (!nopechaKey) {
          return res.status(500).json({ 
            error: 'NopeCHA API key not configured' 
          });
        }

        const captchaSolution = await solveFunCaptcha(nopechaKey);
        
        if (!captchaSolution.success) {
          return res.status(500).json({ 
            error: 'Failed to solve CAPTCHA',
            details: captchaSolution.error 
          });
        }

        const retryBody = JSON.stringify({
          captchaToken: captchaSolution.token,
          captchaProvider: 'PROVIDER_FUNCAPTCHA'
        });

        const retryRes = await httpsRequest(`https://friends.roblox.com/v1/users/${targetUserId}/follow`, {
          method: 'POST',
          headers: {
            'Cookie': `.ROBLOSECURITY=${cookie}`,
            'X-CSRF-TOKEN': csrfToken,
            'Content-Type': 'application/json',
            'Referer': 'https://www.roblox.com/',
            'Roblox-Challenge-Type': 'captcha',
            'Roblox-Challenge-Id': captchaSolution.challengeId,
            'Roblox-Challenge-Metadata': captchaSolution.metadata
          }
        }, retryBody);

        const retryData = retryRes.body ? JSON.parse(retryRes.body) : {};

        if (retryRes.status >= 200 && retryRes.status < 300) {
          return res.status(200).json({
            success: true,
            message: 'Successfully followed user with CAPTCHA',
            data: retryData
          });
        } else {
          return res.status(retryRes.status).json({
            error: 'Failed to follow after solving CAPTCHA',
            details: retryData
          });
        }
      }
    }

    if (followRes.status >= 200 && followRes.status < 300) {
      return res.status(200).json({
        success: true,
        message: 'Successfully followed user',
        data: followData
      });
    } else {
      return res.status(followRes.status).json({
        error: 'Failed to follow user',
        details: followData
      });
    }

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
