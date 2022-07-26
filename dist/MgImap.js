"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MgImap = void 0;
const events_1 = require("events");
const net_1 = require("net");
const tls = require("tls");
const socks_1 = require("socks");
const Parser_1 = require("./Parser");
const mailparser_1 = require("mailparser");
const utf7 = require("utf7").imap;
class MgImap extends events_1.EventEmitter {
    constructor(opts) {
        super();
        this.socketTimeout = 5 * 1000;
        this.tagHandlerMap = new Map();
        this.tagNum = 0;
        this.cmdQueue = [];
        this.currCmd = "";
        this.searchUids = [];
        this.caps = [];
        this.idling = false;
        this.logined = false;
        this.box = {
            name: "",
            flags: [],
            readOnly: false,
            uidvalidity: 0,
            uidnext: 0,
            permFlags: [],
            keywords: [],
            newKeywords: false,
            persistentUIDs: true,
            nomodseq: false,
            messages: {
                total: 0,
                new: 0,
            },
        };
        this.options = opts;
        if (opts.socketTimeout) {
            this.socketTimeout = opts.socketTimeout;
        }
    }
    async connect() {
        if (!this.socket) {
            const { host, port, logger, tlsPort, proxy } = this.options;
            this.initParser();
            if (proxy) {
                try {
                    const info = await socks_1.SocksClient.createConnection({
                        proxy: {
                            host: proxy.host,
                            port: proxy.port,
                            userId: proxy.username,
                            password: proxy.password,
                            type: proxy.type || 5,
                        },
                        command: "connect",
                        destination: {
                            host,
                            port: tlsPort,
                        },
                    });
                    this.createTLS(info.socket);
                    this.handleConnect(info.socket);
                }
                catch (err) {
                    logger && logger("proxy error", err);
                    this.emit("proxyError", new Error("Proxy connect error " + err.message));
                    return;
                }
            }
            else {
                this.socket = new net_1.Socket();
                this.setSocketEvent();
                this.socket.connect({
                    host,
                    port,
                }, () => {
                    this.handleConnect(this.socket);
                });
            }
        }
    }
    /**
     * 发送指令
     * @param cmd
     * @param callback
     */
    sendCmd(cmd, callback) {
        const { logger } = this.options;
        const scmd = `A${++this.tagNum} ${cmd}\r\n`;
        if (this.currCmd === "") {
            this.socket?.write(scmd);
            if (callback) {
                this.tagHandlerMap.set(this.tagNum, callback);
            }
            this.currCmd = cmd;
            logger && logger("=>", scmd);
        }
        else {
            this.cmdQueue.push({ cmd, callback });
        }
        // if (this.tagNum > 9999) {
        //   this.tagNum = 0;
        // }
    }
    /**
     * 登录
     * @returns
     */
    async login() {
        if (this.logined) {
            this.emit("login", true);
            return;
        }
        const { user, password } = this.options;
        return new Promise((resolve) => {
            this.sendCmd(`LOGIN "${user}" "${password}"`, (res) => {
                if (res.result === "ok") {
                    this.logined = true;
                    this.emit("login", true);
                    resolve(true);
                }
                else {
                    this.emit("login", false, res.text);
                    resolve(false);
                }
            });
        });
    }
    async ID(identification) {
        var cmd = 'ID';
        if ((identification === null) || (Object.keys(identification).length === 0))
            cmd += ' NIL';
        else {
            if (Object.keys(identification).length > 30)
                throw new Error('Max allowed number of keys is 30');
            var kv = [];
            for (var k in identification) {
                if (Buffer.byteLength(k) > 30)
                    throw new Error('Max allowed key length is 30');
                if (Buffer.byteLength(identification[k]) > 1024)
                    throw new Error('Max allowed value length is 1024');
                kv.push('"' + escape(k) + '"');
                kv.push('"' + escape(identification[k]) + '"');
            }
            cmd += ' (' + kv.join(' ') + ')';
        }
        return new Promise((resolve) => {
            this.sendCmd(cmd, resolve);
        });
    }
    /**
     * 选择邮箱文件夹
     * @param name
     * @param readOnly
     * @param callback
     */
    async openBox(name, readOnly) {
        name = "" + name;
        let encname = encodeURI(utf7.encode(name)), cmd = readOnly ? "EXAMINE" : "SELECT";
        return new Promise((resolve, reject) => {
            this.sendCmd(`${cmd} "${encname}"`, (res) => {
                if (res.result === "ok") {
                    this.box.name = name;
                    this.box.readOnly = !!readOnly;
                    resolve(this.box);
                }
                else {
                    reject(res.text);
                }
            });
        });
    }
    /**
     * 用uid搜索邮箱
     * @param range ALL 100:200, 100:*
     */
    async searchUid(range) {
        return new Promise((resolve, reject) => {
            this.sendCmd(`UID SEARCH ${range}`, (res) => {
                if (res.result === "ok") {
                    resolve(this.searchUids);
                }
                else {
                    reject(res.text);
                }
            });
        });
    }
    /**
     * 读取uid的邮件内容
     * @param range
     */
    async fetchUid(range) {
        return new Promise((resolve, reject) => {
            this.sendCmd(`UID FETCH ${range.join(",")} (UID FLAGS INTERNALDATE BODYSTRUCTURE BODY[])`, (res) => {
                if (res.result === "ok") {
                    // 读取完成
                    resolve(true);
                }
                else {
                    reject(res.text);
                }
            });
        });
    }
    /**
     * 与邮箱服务器保持连接，但服务器也有可能主动关闭
     * @returns
     */
    async noop() {
        return new Promise((resolve, reject) => {
            this.sendCmd("NOOP", (res) => {
                resolve(res.result === "ok");
            });
        });
    }
    /**
     * 退出
     * @returns
     */
    async logout() {
        return new Promise((resolve, reject) => {
            this.sendCmd("LOGOUT", (res) => {
                if (this.logined && res.result === 'ok') {
                    this.logined = false;
                }
                resolve(res.result === "ok");
            });
        });
    }
    /**
     * 开始监听IDLE
     * @returns
     */
    async idel() {
        return new Promise((resolve, reject) => {
            this.sendCmd("IDLE", (res) => {
                resolve(res.result === "ok");
            });
        });
    }
    /**
     * 邮箱是否支持IDEL，IDEL可以实时获取邮箱状态
     * @returns
     */
    hasIdel() {
        return this.caps.includes("IDLE");
    }
    async startTTLS() {
        return new Promise((resolve, reject) => {
            this.sendCmd("STARTTLS", (res) => {
                if (res.result === "ok") {
                    resolve(true);
                }
                else {
                    reject(res.text);
                }
            });
        });
    }
    async capability() {
        return new Promise((resolve, reject) => {
            this.sendCmd("CAPABILITY", (res) => {
                if (res.result === "ok") {
                    resolve(this.caps);
                }
                else {
                    reject(res.text);
                }
            });
        });
    }
    async createTLS(socket) {
        const { tlsOptions, host, tlsPort } = this.options;
        return new Promise((resolve, reject) => {
            this.socket = tls.connect({
                ...tlsOptions,
                host,
                servername: host,
                port: tlsPort,
                socket,
            }, () => {
                this.setSocketEvent();
                this.state = "connected";
                resolve(true);
            });
            // this.setSocketEvent();
            this.socket.once("error", (err) => {
                reject(err);
            });
            this.socket.once("close", () => {
                reject("close");
            });
            this.socket.once("end", () => {
                reject("end");
            });
        });
    }
    // getStatus(name: string,){
    //   this.sendCmd(``)
    // }
    destroy() {
        this.logined = false;
        this.parser?.removeAllListeners();
        this.parser = undefined;
        this.state = "disconnected";
        this.socket?.removeAllListeners();
        this.socket = undefined;
    }
    handleConnect(sock) {
        this.state = "connected";
        this.emit("connect", sock);
    }
    initParser() {
        if (this.parser)
            return;
        const { logger, proxy } = this.options;
        this.parser = new Parser_1.default(logger);
        this.parser.on("tagged", (res) => {
            // console.log(res);
            this.currCmd = "";
            const handler = this.tagHandlerMap.get(res.tag);
            if (handler) {
                handler(res);
                this.tagHandlerMap.delete(res.tag);
            }
            if (this.cmdQueue.length > 0) {
                const c = this.cmdQueue.shift();
                this.sendCmd(c.cmd, c.callback);
            }
        });
        this.parser.on("untagged", async (res) => {
            // console.log("untagged: ", res);
            const { type, text, num } = res;
            if (type === "ok" && !this.currCmd) {
                // 连接成功服务器返回欢迎信息
                // 获取服务器功能
                await this.capability().catch((text) => { throw new Error(text); });
                if (!proxy && this.caps.includes("STARTTLS")) {
                    // 服务器开启STARTTLS，告诉服务器开始建立tls连接
                    await this.startTTLS().catch((text) => { throw new Error(text); });
                    // 建立tls连接
                    this.createTLS(this.socket).then(() => {
                        this.emit("ready");
                        //  自动登录
                        if (this.options.autoLogin || this.options.autoLogin === undefined)
                            this.login();
                    });
                }
                else {
                    this.emit("ready");
                    //  自动登录
                    if (this.options.autoLogin || this.options.autoLogin === undefined)
                        this.login();
                }
            }
            else if (type === "exists") {
                // 邮箱总数
                const prev = this.box.messages.total, now = res.num || 0;
                this.box.messages.total = now;
                if (now > prev && this.logined) {
                    this.box.messages.new = now - prev;
                }
                this.emit("exists", this.box.messages);
                if (this.idling) {
                    this.socket?.write("DONE\r\n");
                }
            }
            else if (type === 'capability') {
                this.caps = text.map(function (v) { return v.toUpperCase(); });
            }
            else if (type === "flags") {
                // this.box.flags = text;
            }
            else if (type === "recent") {
                this.box.messages.new = num || 0;
            }
            else if (type === "expunge") {
                // 删除
                // if (this.box.messages.total > 0) --this.box.messages.total;
                this.emit("expunge", num || 0);
            }
            else if (type === "bad" || type === "no") {
                if (this.state === "connected") {
                    const err = new Error(this.currCmd ? "Bad command " + this.currCmd : "Received negative welcome: " + text);
                    // console.log(err)
                    this.emit("cmdError", err);
                    this.currCmd = "";
                }
            }
            else if (type === "search") {
                this.searchUids = text;
            }
            else if (type === "bye") {
                this.emit("bye", res);
            }
        });
        this.parser.on("body", (data) => {
            (0, mailparser_1.simpleParser)(data.contents, { skipImageLinks: true, skipTextToHtml: true }, (err, mail) => {
                this.emit("mail", err, { uid: data.uid, mail });
            });
        });
        this.parser.on("continue", (res) => {
            if (res.text === "idling") {
                this.idling = true;
            }
        });
    }
    setSocketEvent() {
        if (!this.socket) {
            throw new Error("Socket is null");
        }
        this.socket.removeAllListeners();
        if (this.options.keepalive) {
            this.socket.setKeepAlive(true);
        }
        const { logger } = this.options;
        // this.socket.on("drain", () => {
        //   const cmds = this.cmdQueue;
        //   this.cmdQueue = [];
        //   cmds.forEach((c) => {
        //     this.sendCmd(c.cmd, c.callback);
        //   });
        // });
        this.socket.once("close", (had_err) => {
            logger && logger("socket close had_err ", had_err);
            this.destroy();
            this.emit("close", had_err);
        });
        this.socket.once("end", () => {
            logger && logger("socket end");
            this.destroy();
            this.emit("end");
        });
        this.socket.once("error", (err) => {
            logger && logger("socket error", err);
            this.destroy();
            this.emit("socketError", err);
        });
        this.socket.once("timeout", () => {
            logger && logger("socket timeout");
            this.destroy();
            this.emit("timeout");
        });
        this.socket.on("data", (data) => {
            this.parser?.parse(data);
            this.emit("message", data);
        });
    }
}
exports.MgImap = MgImap;
//# sourceMappingURL=MgImap.js.map