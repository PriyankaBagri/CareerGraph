export interface Logger { info(msg: string, meta?: object): void; warn(msg: string, meta?: object): void; error(msg: string, meta?: object): void }
const line = (level: string, msg: string, meta?: object) => console.log(JSON.stringify({ level, time: new Date().toISOString(), msg, ...meta }));
export const consoleLogger: Logger = { info: (m, x) => line('info', m, x), warn: (m, x) => line('warn', m, x), error: (m, x) => line('error', m, x) };
export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
