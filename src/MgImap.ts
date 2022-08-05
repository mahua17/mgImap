import { EventEmitter } from "events";
import { Socket } from "net";
import * as tls from "tls";
import { SocksClient } from "socks";
import Parser from "./Parser";
import { ParsedMail, simpleParser } from "mailparser";

const buildSearchQuery = require("./funs").buildSearchQuery;
const utf7 = require("utf7").imap;

interface MgImapOptions {
  user: string;
  password: string;
  host: string;
  port: number;
  tlsPort: number;
  tls?: boolean;
  autoLogin?: boolean;
  keepalive?: boolean;
  socketTimeout?: number;
  connTimeout?: number;
  authTimeout?: number;
  tlsOptions?: tls.TLSSocketOptions;
  proxy?: {
    host: string;
    port: number;
    username?: string;
    password?: string;
    type?: 4 | 5;
  };
  logger?: (...args: any[]) => any;
}

interface TagResponse {
  result: "ok" | "no" | "bad";
  tag: number;
  text: string;
  textCode?: string;
}

interface UntaggedResponse {
  type: string;
  num?: number;
  textCode?: string;
  text?: any;
}

interface OpenBoxResponse {
  name: string;
  flags: any[];
  readOnly: boolean;
  uidvalidity: number;
  uidnext: number;
  permFlags: any[];
  keywords: any[];
  newKeywords: boolean;
  persistentUIDs: boolean;
  nomodseq: boolean;
  messages: {
    total: number;
    new: number;
  };
}

declare interface MgImap {
  on(event: string, listener: (...args: unknown[]) => void): this;
  on(event: 'proxyError', listener: (err: Error) => void): this;
  on(event: 'socketError', listener: (err: Error) => void): this;
  on(event: 'connect', listener: (socket: Socket) => void): this;
  on(event: 'cmdError', listener: (err: Error) => void): this;
  on(event: 'login', listener: (isLogin: boolean, err?: string) => void): this;
  on(event: 'bye', listener: (res: UntaggedResponse) => void): this;
  on(event: 'ready', listener: () => void): this;
  on(event: 'exists', listener: (res: { total: number, new: number }) => void): this;
  on(event: 'expunge', listener: (res: number) => void): this;
  on(event: 'close', listener: (had_err: boolean) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'timeout', listener: () => void): this;
  on(event: 'message', listener: (msg: Buffer) => void): this;
  on(event: 'mail', listener: (err: any, data: { uid: number, mail: ParsedMail }) => void): this;
  on(event: 'destroy', listener:()=>void): this;

  emit(event: string | symbol, ...args: unknown[]): boolean;
  emit(event: 'proxyError', err: Error): boolean;
  emit(event: 'socketError', info: Error): boolean;
  emit(event: 'connect', socket: Socket): boolean;
  emit(event: 'cmdError', err: Error): boolean;
  emit(event: 'login', isLogin: boolean, err?: string): boolean;
  emit(event: 'bye', res: UntaggedResponse): boolean;
  emit(event: 'ready'): boolean;
  emit(event: 'exists', res: { total: number, new: number }): boolean;
  emit(event: 'expunge', res: number): boolean;
  emit(event: 'close', had_err: boolean): boolean;
  emit(event: 'end'): boolean;
  emit(event: 'timeout'): boolean;
  emit(event: 'message', msg: Buffer): boolean;
  emit(event: 'mail', err: any, data: { uid: number, mail: ParsedMail }): boolean;
  emit(event: 'destroy'): boolean;
}

class MgImap extends EventEmitter implements MgImap {
  private options: MgImapOptions;

  private socket?: Socket;

  socketTimeout: number = 5 * 1000;

  private state?: "disconnected" | "connected";

  private tagHandlerMap: Map<number | string, (res: TagResponse) => void> = new Map();

  private tagNum = 0;

  private cmdQueue: { cmd: string; callback?: (res: any) => void }[] = [];

  private currCmd: string = "";

  private parser?: Parser;

  private searchUids: number[] = [];

  private caps: string[] = [];

  private idling: boolean = false;

  private logined: boolean = false;

  private box: OpenBoxResponse = {
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

  constructor(opts: MgImapOptions) {
    super();
    this.options = opts;
    if (opts.socketTimeout) {
      this.socketTimeout = opts.socketTimeout;
    }
  }

  async connect() {
    if (!this.socket) {
      const { host, port, logger, tlsPort, proxy } =
        this.options;

      this.initParser();

      if (proxy) {
        try {
          const info = await SocksClient.createConnection({
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
          this.createTLS(info.socket).then(()=>{
            this.handleConnect(info.socket);
          }).catch(()=>{
            this.emit("socketError", new Error("Tls error"))
          })
        } catch (err: any) {
          logger && logger("proxy error", err);
          this.emit("proxyError", new Error("Proxy connect error " + err.message))
          return;
        }
      } else {
        this.socket = new Socket();
        this.setSocketEvent();
        this.socket.connect(
          {
            host,
            port,
          },
          () => {
            this.handleConnect(this.socket!);
          }
        );
      }
    }
  }

  /**
   * 发送指令
   * @param cmd
   * @param callback
   */
  sendCmd(cmd: string, callback?: (res: TagResponse) => void) {
    const { logger } = this.options;
    const scmd = `A${++this.tagNum} ${cmd}\r\n`;
    if (this.currCmd === "") {
      this.socket?.write(scmd)
      if (callback) {
        this.tagHandlerMap.set(this.tagNum, callback);
      }
      this.currCmd = cmd;
      logger && logger("=>", scmd);
    } else {
      this.cmdQueue.push({ cmd, callback });
    }
  }

  /**
   * 登录
   * @returns
   */
  async login() {
    const { user, password } = this.options;
    return new Promise<boolean>((resolve) => {
      if (this.logined) {
        resolve(true);
        return;
      }
      this.sendCmd(`LOGIN "${user}" "${password}"`, (res) => {
        if (res.result === "ok") {
          this.logined = true;
          this.emit("login", true);
          resolve(true);
        } else {
          this.emit("login", false, res.text);
          resolve(false);
        }
      });
    });
  }

  async ID(identification: any) {
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
        kv.push('"' + encodeURI(k) + '"');
        kv.push('"' + encodeURI(identification[k]) + '"');
      }
      cmd += ' (' + kv.join(' ') + ')';
    }

    return new Promise((resolve) => {
      this.sendCmd(cmd, resolve);
    })
  }


  /**
   * 选择邮箱文件夹
   * @param name
   * @param readOnly
   * @param callback
   */
  async openBox(name: string, readOnly?: boolean) {
    name = "" + name;
    let encname = encodeURI(utf7.encode(name)),
      cmd = readOnly ? "EXAMINE" : "SELECT";

    return new Promise<OpenBoxResponse>((resolve, reject) => {
      this.sendCmd(`${cmd} "${encname}"`, (res) => {
        if (res.result === "ok") {
          this.box.name = name;
          this.box.readOnly = !!readOnly;
          resolve(this.box);
        } else {
          reject(res.text);
        }
      });
    });
  }

  /**
   * 用uid搜索邮箱
   * @param range ALL 100:200, 100:*
   */
  async searchUid(range: string) {
    return new Promise<number[]>((resolve, reject) => {
      this.sendCmd(`UID SEARCH UID ${range}`, (res) => {
        if (res.result === "ok") {
          resolve(this.searchUids);
        } else {
          reject(this.currCmd +"\r\n"+ res.text);
        }
      });
    });
  }

  /**
   * 条件查询
   */
  async search(criteria:any) {
    var cmd = 'UID SEARCH',
      info = { hasUTF8: false /*output*/ },
      query = buildSearchQuery(criteria, this.caps, info);
      // lines;
    // if (info.hasUTF8) {
    //   cmd += ' CHARSET UTF-8';
    //   lines = query.split("\r\n");

    //   query = lines.shift();
    // }
    cmd += query;

    return new Promise<number[]>((resolve, reject) => {
      this.sendCmd(cmd, (res) => {
        if (res.result === "ok") {
          resolve(this.searchUids);
        } else {
          reject(this.currCmd +"\r\n"+ res.text);
        }
      });
    });
  }

  /**
   * 读取uid的邮件内容
   * @param range
   */
  async fetchUid(range: number[]) {
    return new Promise<any>((resolve, reject) => {
      this.sendCmd(
        `UID FETCH ${range.join(",")} (UID FLAGS INTERNALDATE BODYSTRUCTURE BODY[])`,
        (res) => {
          if (res.result === "ok") {
            // 读取完成
            resolve(true)
          } else {
            reject(res.text);
          }
        }
      );
    });
  }

  /**
   * 与邮箱服务器保持连接，但服务器也有可能主动关闭
   * @returns 
   */
  async noop() {
    return new Promise<boolean>((resolve, reject) => {
      this.sendCmd("NOOP", (res) => {
        resolve(res.result === "ok");
      })
    })
  }

  /**
   * 退出
   * @returns 
   */
  async logout() {
    return new Promise<boolean>((resolve, reject) => {
      this.sendCmd("LOGOUT", (res) => {
        if (this.logined && res.result === 'ok') {
          this.logined = false;
        }
        resolve(res.result === "ok");
      })
    })
  }

  /**
   * 开始监听IDLE
   * @returns 
   */
  async idel() {
    return new Promise<boolean>((resolve, reject) => {
      this.sendCmd("IDLE", (res) => {
        resolve(res.result === "ok");
      })
    })
  }

  /**
   * 邮箱是否支持IDEL，IDEL可以实时获取邮箱状态
   * @returns 
   */
  hasIdel() {
    return this.caps.includes("IDLE");
  }

  isLogin() {
    return this.logined;
  }

  private async startTTLS() {
    return new Promise<any>((resolve, reject) => {
      this.sendCmd(
        "STARTTLS",
        (res) => {
          if (res.result === "ok") {
            resolve(true)
          } else {
            reject(res.text);
          }
        }
      );
    });
  }

  private async capability() {
    return new Promise<any>((resolve, reject) => {
      this.sendCmd(
        "CAPABILITY",
        (res) => {
          if (res.result === "ok") {
            resolve(this.caps)
          } else {
            reject(res.text);
          }
        }
      );
    });
  }

  private async createTLS(socket: Socket) {
    const { tlsOptions, host, tlsPort } = this.options;
    return new Promise((resolve, reject) => {
      this.socket = tls.connect(
        {
          ...tlsOptions,
          host,
          servername: host,
          port: tlsPort,
          socket,
        },
        () => {
          this.setSocketEvent()
          this.state = "connected"
          resolve(true)
        }
      );
      // this.setSocketEvent();

      this.socket.once("error", (err) => {
        reject(err)
      })

      this.socket.once("close", () => {
        reject("close")
      })

      this.socket.once("end", () => {
        reject("end")
      })
    })
  }

  // getStatus(name: string,){
  //   this.sendCmd(``)
  // }

  destroy() {
    if(this.state === "disconnected") return;
    this.logined = false;
    this.parser?.removeAllListeners();
    this.parser = undefined;
    this.state = "disconnected";
    this.socket?.removeAllListeners();
    this.socket?.destroy()
    this.socket = undefined;
    this.emit("destroy")
  }

  private handleConnect(sock: Socket) {
    this.state = "connected";
    this.emit("connect", sock);
  }

  private initParser() {
    if (this.parser) return;

    const { logger, proxy } = this.options
    this.parser = new Parser(logger);

    this.parser.on("tagged", (res: TagResponse) => {
      // console.log(res);
      const handler = this.tagHandlerMap.get(res.tag);
      if (handler) {
        handler(res);
        this.tagHandlerMap.delete(res.tag);
      }
      this.currCmd = ""
      if (this.cmdQueue.length > 0) {
        const c = this.cmdQueue.shift();
        this.sendCmd(c!.cmd, c!.callback);
      }
    });

    this.parser.on("untagged", async (res: UntaggedResponse) => {
      // console.log("untagged: ", res);
      const { type, text, num } = res;
      if (type === "ok" && !this.currCmd) {
        // 连接成功服务器返回欢迎信息
        // 获取服务器功能
        await this.capability().catch((text) => { throw new Error(text) })
        if (!proxy && this.caps.includes("STARTTLS")) {
          // 服务器开启STARTTLS，告诉服务器开始建立tls连接
          await this.startTTLS().catch((text) => { throw new Error(text) })
          // 建立tls连接
          this.createTLS(this.socket!).then(() => {
            this.emit("ready")
            //  自动登录
            if (this.options.autoLogin || this.options.autoLogin === undefined)
              this.login();
          })
        } else {
          this.emit("ready")
          //  自动登录
          if (this.options.autoLogin || this.options.autoLogin === undefined)
            this.login();
        }

      } else if (type === "exists") {
        // 邮箱总数
        const prev = this.box.messages.total,
          now = res.num || 0;
        this.box.messages.total = now;
        if (now > prev && this.logined) {
          this.box.messages.new = now - prev;
        }
        this.emit("exists", this.box.messages);

        if (this.idling) {
          this.socket?.write("DONE\r\n");
          this.idling = false;
        }

      } else if (type === 'capability') {
        this.caps = text.map(function (v: string) { return v.toUpperCase(); });
      } else if (type === "flags") {
        // this.box.flags = text;
      } else if (type === "recent") {
        this.box.messages.new = num || 0;
      } else if (type === "expunge") {
        // 删除
        // if (this.box.messages.total > 0) --this.box.messages.total;
        this.emit("expunge", num || 0);
      } else if (type === "bad" || type === "no") {
        if (this.state === "connected") {
          const err = new Error(this.currCmd ? "Bad command " + this.currCmd : "Received negative welcome: " + text);
          // console.log(err)
          this.emit("cmdError", err);
          this.currCmd = ""
        }
      } else if (type === "search") {
        this.searchUids = text;
      } else if (type === "bye") {
        this.emit("bye", res)
      }

    });

    this.parser.on("body", (data: { uid: number, contents: string | Buffer }) => {
      simpleParser(data.contents, { skipImageLinks: true, skipTextToHtml: true }, (err, mail) => {
        this.emit("mail", err, { uid: Number(data.uid), mail })
      })

      // this.emit("mail", null, {uid: Number(data.uid)})
    })

    this.parser.on("continue", (res: { textCode?: string, text: string }) => {
      if (res.text === "idling") {
        this.idling = true;
      }
    })
  }

  private setSocketEvent() {

    if (!this.socket) {
      throw new Error("Socket is null")
    }

    this.socket.removeAllListeners()

    if (this.options.keepalive) {
      this.socket.setKeepAlive(true);
    }

    const { logger } = this.options

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

    this.socket.on("data", (data: Buffer) => {
      logger && logger(`<=`, data.toString("utf-8"));
      this.parser?.parse(data);
    });
  }
}


export { MgImap, MgImapOptions, TagResponse, UntaggedResponse, OpenBoxResponse, ParsedMail }