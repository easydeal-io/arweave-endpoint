const Koa = require('koa');
const Router = require('koa-router');
const koaBody = require('koa-body');
const KoaLogger = require("koa-logger");
const fs = require('fs');
const fileType = require('file-type');

const moment = require('moment');

const cors = require('@koa/cors');
const arweaveUtil = require('./arweave-util');

const app = new Koa();
const router = new Router();

const PORT = 3001;

const logger = KoaLogger();

const VALID_MIME = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/bmp'
];

function success(data) {
  return {
    success: true,
    data
  }
}

function error(err) {
  return {
    success: false,
    message: err.toString()
  }
}

const cacheFolder = './cache';
let cacheData = fs.readdirSync(cacheFolder), 
  totalSize = 0, readData = {};

cacheData.forEach((cache, idx) => {
  let file = cacheFolder + '/' + cache;
  fs.stat(file, function(err, stats) {
    readData[cache] = {
      size: stats.size,
      updateTime: moment(stats.mtimeMs).format('YYYY-MM-DD HH:mm:ss')
    }
    totalSize += stats.size;
  });
});

const statsCacheFile = './stats-cache.json';

router.get('/', async (ctx, next) => {
  try {
    let statsCache = {
      addr: 'LqHtqKcl4qmJWQE_ZRlbCtJiH2E46FibrS5qUlSBJl0', balance: 0
    };

    if (fs.existsSync(statsCacheFile)) {
      statsCache = fs.readFileSync(statsCacheFile);
      statsCache = JSON.parse(statsCache);
    }

    let html = `
      <html>
        <head>
          <title>Arweave Endpoint</title>
        </head>
        <body>
          <h3>Status:</h3>
          <p>Address: <a target="_blank" href="https://viewblock.io/arweave/address/${statsCache.addr}">${statsCache.addr}</a></p>
          <p>Balance: ${statsCache.balance} Wins (${arweaveUtil.instance.ar.winstonToAr(statsCache.balance)} Ar)</p>
          <h4>Cached: ${cacheData.length} Files. Total Size: ${totalSize / (1024 * 1024)} Mb</h4>
          <ul id="links"></ul>
          <script>
            var readData = '${JSON.stringify(readData)}';
            
            var wrapper = document.getElementById('links');
            readData = JSON.parse(readData);

            var keys = Object.keys(readData);

            keys.forEach(key => {
              var item = readData[key];
            
              var li = document.createElement('li');
              li.innerHTML = '<p><a target="_blank" href="https://arweave.net/tx/' + key + '">' + key + '</a></p>' +
              '<p><span>Size: ' + item.size / (1024 * 1024) + ' Mb, Update Time: ' + item.updateTime + '</span></p>';
              
              wrapper.appendChild(li);
            });

            var idx = 0;
            const lis = document.querySelectorAll('ul li');
            function getStatus() {
              var tx = keys[idx];
              var li = lis[idx];
              
              fetch('./status/' + tx).then(data => data.json()).then(json => {
                var p = li.querySelector('p:first-child');
                var span = document.createElement('span');
                span.style = json.data.confirmed ? 'color:#87d068' : 'color:#f50';
                span.innerHTML = json.data.confirmed ? ' ✔ ' : ' ✘ ';
                span.innerHTML += 'status: ' + json.data.status + ', ' + 
                  'confirmed: ' + (json.data.confirmed ? json.data.confirmed.number_of_confirmations : 'null');
                p.appendChild(span);

                if (idx < (keys.length - 1)) {
                  idx ++;
                  getStatus();
                }
              }).catch(err => {
                if (idx < (keys.length - 1)) {
                  idx ++;
                  getStatus();
                }
              });
            }
            getStatus();
          </script>
        </body>
      </html>
    `;

    ctx.body = html;

    Promise.all([
      arweaveUtil.getWalletAddress(),
      arweaveUtil.getBalance()
    ]).then(([addr, balance]) => {
      fs.writeFile('stats-cache.json', JSON.stringify({
        addr, balance
      }), function (){});
    });
    
  } catch(err) {
    
    ctx.body = `
      <html>
        <head>
          <title>Arweave Endpoint</title>
        </head>
        <body>
          <h3>Status: error</h3>
        </body>
      </html>
    `;
  }
});

router.get('/tx/:id', async (ctx, next) => {
  const { id } = ctx.params;
  try {
    const data = await arweaveUtil.getData(id);
    const type = await fileType.fromBuffer(data);
    const buffer = Buffer.from(data, 'hex');
    ctx.status = 200;
    ctx.set('Content-Type', type.mime);
    // ctx.type = type.mime;
    ctx.body = buffer;
    ctx.length = Buffer.byteLength(buffer);
  } catch(err) {
    ctx.status = 404;
  }
});

router.get('/status/:id', async (ctx, next) => {
  const { id } = ctx.params;
  try {
    const status = await arweaveUtil.getStatus(id);
    ctx.body = success(status);
  } catch(err) {
    ctx.body = error(err);
  }
});

router.post('/upload', async (ctx, next) => {
  const { file } = ctx.request.files;
  try {
    console.log('--> Received file size', file.size, ', ready to post.');
    const result = await postTo(file);
    ctx.body = success(result);
  } catch(err) {
    ctx.body = error(err);
  };
  
});

function postTo(file) {
  return new Promise((resolve, reject) => {
    if (VALID_MIME.indexOf(file.type) < 0) {
      reject('File type invalid.');
    }
    const stream = fs.createReadStream(file.path);
   
    const buffers = [];
    stream.on('data', function(buffer) {
      buffers.push(buffer);
    });
    stream.on('end', function() {
     
      const data = Buffer.concat(buffers);
     
      arweaveUtil.post(Uint8Array.from(data), file.type).then(txId => {
        resolve(txId);
      }).catch(err => {
        reject(err);
      });
    });
  });
}

app
  .use(koaBody({
    multipart: true,
    formidable: {
      maxFileSize: 3 * 1024 * 1024
    }
  }))
  .use(logger)
  .use(cors())
  .use(router.routes())
  .use(router.allowedMethods());

app.listen(PORT);

console.log('Server listen on port:', PORT);