const Koa = require('koa');
const Router = require('koa-router');

const koaBody = require('koa-body');
const KoaLogger = require("koa-logger");

const fs = require('fs');
const path = require('path');
const fileType = require('file-type');

const render = require('koa-ejs');

const moment = require('moment');

const cors = require('@koa/cors');
const arweaveUtil = require('./arweave-util');

const app = new Koa();
const router = new Router();

const PORT = 3001;

const logger = KoaLogger();

render(app, {
  root: path.join(__dirname, 'views'),
  viewExt: 'html',
  layout: false,
  cache: false,
  debug: false,
});

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

const statsCacheFile = './stats-cache.json';

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

router.get('/', async (ctx, next) => {
  try {

    let statsCache = {
      addr: '', balance: 0, balanceAr: 0
    };

    if (fs.existsSync(statsCacheFile)) {
      statsCache = fs.readFileSync(statsCacheFile);
      statsCache = JSON.parse(statsCache);
    }

    await ctx.render('index', {
      statsCache,
      cacheData,
      totalSize,
      readData
    });
    
    Promise.all([
      arweaveUtil.getWalletAddress(),
      arweaveUtil.getBalance()
    ]).then(([addr, balance]) => {
      fs.writeFile('stats-cache.json', JSON.stringify({
        addr, balance, balanceAr: arweaveUtil.instance.ar.winstonToAr(balance)
      }), function (){});
    });

    fs.readdir(cacheFolder, function(err, data) {
      if (!err) {
        cacheData = data;
      }
    });
    
  } catch(err) {
    console.log(err);
    await ctx.render('error');
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
        cacheData.push(txId);
        totalSize += file.size;
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