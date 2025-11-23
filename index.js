const fs = require('fs');
const express = require('express');
const axios = require('axios');
const session = require('express-session');
const chokidar = require('chokidar');


//example：http://127.0.0.1:8082/?url=https://www.baidu.com

const app = express();

let config = {};

function loadConfig() {
  try {
    const rawData = fs.readFileSync('./config.json', 'utf8');
    config = JSON.parse(rawData);
    console.log('Config loaded:', config);
  } catch (err) {
    console.error('Config lading failed:', err.message);
  }
}

loadConfig();

chokidar.watch('./config.json', { persistent: true }).on('change', () => {
  console.log('Config file updated, reloading the server...');
  loadConfig();
});

app.use(session({
  secret: config.secret, 
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

function isValidUrl(url) {
  const urlRegex = /^(https?:\/\/)[^\s/$.?#].[^\s]*$/i;
  return urlRegex.test(url);
}

function isBlacklisted(url) {
  if (!config.blacklist || !Array.isArray(config.blacklist)) return false;
  const blacklistRegex = new RegExp(config.blacklist.join('|'), 'i');
  return blacklistRegex.test(url);
}

function getTargetUrl(baseUrl, path) {
  if (!baseUrl) return '';
  const normalizedPath = path.replace(/^\//, '');
  return normalizedPath ? `${baseUrl}/${normalizedPath}` : `${baseUrl}`;
}

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'OPTIONS') {
    return res.status(405).send('Only GET and OPTIONS requests are allowed!');
  }
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','');
  next();
});


app.get( /.*/, (req, res) => {
  try {
    if(req.path === '/proxy.html'){
      res.setHeader('Content-Type','text/html');
      return  res.sendFile(__dirname+'/proxy.html');
    }else if(req.path === '/proxy2.html'){
      res.setHeader('Content-Type','text/html');
      return  res.sendFile(__dirname+'/proxy2.html');
    }

    const length = Object.keys(req.query).length;
    let reqUrl = '';

    if (length == 1) {
 	reqUrl = req.query.url || '';
 } else if (length > 1 && req.url.indexOf('?url=')) {
 	reqUrl = req.url.substring(req.url.indexOf('?url=') + 5);
 }

    const userAgent = req.headers['user-agent'] || '';

    if (reqUrl && !isValidUrl(reqUrl)) {
      console.warn('Invalid URL detected:', reqUrl);
      return res.status(400).send('URL format incorrect!');
    }

    if (reqUrl && isBlacklisted(reqUrl)) {
      console.error(`${req.ip}the domain is in the blacklist`, reqUrl);
      return res.status(403).send('The domain you are trying to access is on the blacklist and access is prohibited!');
    }


    if (reqUrl) {
      req.session.url = reqUrl;
    }

    const baseUrl = req.session.url || '';
    if (!baseUrl) {
      return res.status(400).send('No URL parameters were found in the session. The user will be automatically redirected to the homepage after 3 seconds! <script>setTimeout(()=>{location.href="/proxy.html"},3000);</script>');
    }

    const targetUrl = getTargetUrl(baseUrl, req.path);
    if (!isValidUrl(targetUrl)) {
      console.warn('Generated target URL is invalid:', targetUrl);
      return res.status(400).send('The generated URL format is incorrect!');
    }

     console.info(`${req.ip}The user requested access to ${targetUrl}!`);

    const headers = req.headers;
    headers['referer'] = (new URL(baseUrl)).origin;
    headers['host'] = (new URL(targetUrl)).host;
    headers['user-agent'] = userAgent;
   
 axios.get(targetUrl, {
  headers,
  responseType: 'stream'
})
  .then(response => {
    const contentType = response.headers['content-type'];
    console.log(`Response header content: ${contentType}`);
    
    res.setHeader('Content-Type', contentType);

    if (contentType && /^(text\/html|text\/css|application\/javascript|application\/json|font\/|image\/svg\+xml)/i.test(contentType)) {
      let data = '';
      response.data.on('data', chunk => {
        data += chunk;
      });
      response.data.on('end', () => {
        res.send(data);
      });
    } else if (contentType && /^(audio|video|image|application\/octet-stream)/i.test(contentType)) {
      response.data.pipe(res);
    } else {
      response.data.pipe(res);
    }
  })
  .catch(error => {
    console.error('Error fetching target URL:', error.message);
    res.status(500).send(error.message);
  });

  } catch (err) {
    console.error('Unhandled error:', err.message);
    res.status(500).send(err.message);
  }
});

app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
});

