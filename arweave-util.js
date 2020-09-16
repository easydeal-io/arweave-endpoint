const Arweave = require('arweave');
const fs = require('fs');

const { exit } = require('process');

let arweave = arweaveBackup = Arweave.init({
  host: 'arweave.net',// Hostname or IP address for a Arweave host
  port: 443,          // Port
  protocol: 'https',  // Network protocol http or https
  timeout: 30000,     // Network request timeouts in milliseconds
  logging: false,     // Enable network request logging
});

console.log('Initializing...');
arweave.network.getInfo().then(info => {
  console.log('Initialized. Network info:', info);
});

// get key
let key = fs.readFileSync('key.store');
if (!key) {
  exit('Arweave keystore not found.');
}

key = JSON.parse(key);

function getWalletAddress() {
  return arweave.wallets.jwkToAddress(key);
}

function getBalance() {
  return getWalletAddress().then(addr => {
    return arweave.wallets.getBalance(addr)
  });
}

function getData(txId) {
  return new Promise((resolve, reject) => {
    let cacheFile = `cache/${txId}`;
    console.log('Get data of tx:', txId);
    fs.exists(cacheFile, function (exists) {
      if (exists) {
        console.log('Get data from cache');
        fs.readFile(cacheFile, { encoding: 'binary' }, function (err, data) {
          if (!err) {
            resolve(Buffer.from(data, 'binary'));
          } else {
            reject(err);
          }
        });
      } else {
        let timestamp = new Date().getTime();
        arweave.transactions.getData(txId, { decode: true }).then(data => {
          if (data && data.length) {
            return data;
          } else {
            console.log('Get data from backup instance.')
            return arweaveBackup.transactions.getData(txId, { decode: true });
          }
        }).then(data => {
          let now  = new Date().getTime();
          let diff = now - timestamp;
          console.log(`Get data done, time: ${diff}ms`);
          resolve(data);
          fs.writeFile(cacheFile, Buffer.from(data), function(err) {
            if (!err) {
              console.log('Write cache success.');
            } else {
              console.log('Write cache failed.');
            }
          });
        }).catch(err => {
          console.log('Get data error:', err);
          reject(err);
        });
      }
    });
  });
}

function getStatus(txId) {
  return arweave.transactions.getStatus(txId);
}

function post(data, mime) {
  console.log('Post data ->');
  let timestamp = new Date().getTime();
  return new Promise((resolve, reject) => {
    let transaction;
    arweave.createTransaction({ 
      data
    }, key).then(tx => {
      transaction = tx;
      tx.addTag('Content-Type', mime);
      return arweave.transactions.sign(tx, key);
    }).then(() => {
      arweave.transactions.getUploader(transaction).then(uploader => {
        if (!uploader.isComplete) {
          uploader.uploadChunk();
        }
        let txId = uploader.transaction.id;
        let now = new Date().getTime();
        let diff = now - timestamp;
        console.log('Post data done. Time: ', diff, 'ms');
        resolve(txId);
        let cacheFile = `cache/${txId}`;
        fs.writeFile(cacheFile, Buffer.from(data), function(err) {});
      }).catch(err => {
        reject(err);
      })
    }).catch(err => {
      reject(err);
    });
  })
}

module.exports = {
  getWalletAddress,
  getBalance,
  post,
  getData,
  getStatus,
  post,
  instance: arweave
}