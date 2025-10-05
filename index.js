// api/follow.js
const fetch = require('node-fetch');

module.exports = async (req, res) => {
  // Set CORS headers
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

    // Step 1: Get CSRF token
    const csrfResponse = await fetch('https://auth.roblox.com/v1/authentication-ticket', {
      method: 'POST',
      headers: {
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'Referer': 'https://www.roblox.com/'
      }
    });

    const csrfToken = csrfResponse.headers.get('x-csrf-token');
    
    if (!csrfToken) {
      return res.status(401).json({ 
        error: 'Failed to get CSRF token. Cookie may be invalid.' 
      });
    }

    // Step 2: Attempt to follow user
    const followResponse = await fetch(`https://friends.roblox.com/v1/users/${targetUserId}/follow`, {
      method: 'POST',
      headers: {
        'Cookie': `.ROBLOSECURITY=${cookie}`,
        'X-CSRF-TOKEN': csrfToken,
        'Content-Type': 'application/json',
        'Referer': 'https://www.roblox.com/'
      }
    });

    const followData = await followResponse.json();

    // Step 3: Check if CAPTCHA is required
    if (followResponse.status === 403 && followData.errors) {
      const captchaError = followData.errors.find(e => 
        e.message && e.message.toLowerCase().includes('captcha')
      );
      
      if (captchaError) {
        // CAPTCHA required - use NopeCHA
        const nopechaKey = process.env.NOPECHA_API_KEY;
        
        if (!nopechaKey) {
          return res.status(500).json({ 
            error: 'NopeCHA API key not configured' 
          });
        }

        // Get FunCaptcha token from NopeCHA
        const captchaSolution = await solveFunCaptcha(nopechaKey);
        
        if (!captchaSolution.success) {
          return res.status(500).json({ 
            error: 'Failed to solve CAPTCHA',
            details: captchaSolution.error 
          });
        }

        // Retry follow with CAPTCHA token
        const retryResponse = await fetch(`https://friends.roblox.com/v1/users/${targetUserId}/follow`, {
          method: 'POST',
          headers: {
            'Cookie': `.ROBLOSECURITY=${cookie}`,
            'X-CSRF-TOKEN': csrfToken,
            'Content-Type': 'application/json',
            'Referer': 'https://www.roblox.com/',
            'Roblox-Challenge-Type': 'captcha',
            'Roblox-Challenge-Id': captchaSolution.challengeId,
            'Roblox-Challenge-Metadata': captchaSolution.metadata
          },
          body: JSON.stringify({
            captchaToken: captchaSolution.token,
            captchaProvider: 'PROVIDER_FUNCAPTCHA'
          })
        });

        const retryData = await retryResponse.json();

        if (retryResponse.ok) {
          return res.status(200).json({
            success: true,
            message: 'Successfully followed user with CAPTCHA',
            data: retryData
          });
        } else {
          return res.status(retryResponse.status).json({
            error: 'Failed to follow after solving CAPTCHA',
            details: retryData
          });
        }
      }
    }

    // Step 4: Return result if no CAPTCHA needed
    if (followResponse.ok) {
      return res.status(200).json({
        success: true,
        message: 'Successfully followed user',
        data: followData
      });
    } else {
      return res.status(followResponse.status).json({
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

async function solveFunCaptcha(apiKey) {
  try {
    // Create NopeCHA task
    const createResponse = await fetch('https://api.nopecha.com/task', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        type: 'funcaptcha',
        sitekey: '476068BF-9607-4799-B53D-966BE98E2B81', // Roblox FunCaptcha sitekey
        url: 'https://www.roblox.com'
      })
    });

    const createData = await createResponse.json();
    
    if (!createData.data || !createData.data.task_id) {
      return { 
        success: false, 
        error: 'Failed to create CAPTCHA task' 
      };
    }

    const taskId = createData.data.task_id;

    // Poll for solution (max 60 seconds)
    for (let i = 0; i < 30; i++) {
      await sleep(2000); // Wait 2 seconds between checks

      const resultResponse = await fetch(`https://api.nopecha.com/task/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      const resultData = await resultResponse.json();

      if (resultData.data && resultData.data.status === 'completed') {
        return {
          success: true,
          token: resultData.data.solution,
          challengeId: resultData.data.challenge_id || '',
          metadata: resultData.data.metadata || ''
        };
      }

      if (resultData.data && resultData.data.status === 'failed') {
        return { 
          success: false, 
          error: 'CAPTCHA solving failed' 
        };
      }
    }

    return { 
      success: false, 
      error: 'CAPTCHA solving timeout' 
    };

  } catch (error) {
    return { 
      success: false, 
      error: error.message 
    };
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
