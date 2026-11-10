const dns = require('node:dns');

const originalLookup = dns.lookup;
const resolver = new dns.promises.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);

dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (typeof hostname === 'string' && hostname.includes('neon.tech')) {
    resolver.resolve4(hostname).then((addresses) => {
      if (addresses && addresses.length > 0) {
        if (options && options.all) {
          callback(null, addresses.map(a => ({ address: a, family: 4 })));
        } else {
          callback(null, addresses[0], 4);
        }
      } else {
        originalLookup(hostname, options, callback);
      }
    }).catch(() => {
      originalLookup(hostname, options, callback);
    });
    return;
  }
  return originalLookup(hostname, options, callback);
};
