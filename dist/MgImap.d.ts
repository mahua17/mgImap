/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import { EventEmitter } from "events";
import { Socket } from "net";
import * as tls from "tls";
import { ParsedMail } from "mailparser";
interface MgImapOptions {
    user: string;
    password: string;
    host: string;
    port: number;
    tlsPort: number;
    tls?: boolean;
    startTLS?: boolean;
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
    on(event: 'exists', listener: (res: {
        total: number;
        new: number;
    }) => void): this;
    on(event: 'expunge', listener: (res: number) => void): this;
    on(event: 'close', listener: (had_err: boolean) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'timeout', listener: () => void): this;
    on(event: 'message', listener: (msg: Buffer) => void): this;
    on(event: 'mail', listener: (err: any, data: {
        uid: number;
        mail: ParsedMail;
    }) => void): this;
    on(event: 'destroy', listener: () => void): this;
    emit(event: string | symbol, ...args: unknown[]): boolean;
    emit(event: 'proxyError', err: Error): boolean;
    emit(event: 'socketError', info: Error): boolean;
    emit(event: 'connect', socket: Socket): boolean;
    emit(event: 'cmdError', err: Error): boolean;
    emit(event: 'login', isLogin: boolean, err?: string): boolean;
    emit(event: 'bye', res: UntaggedResponse): boolean;
    emit(event: 'ready'): boolean;
    emit(event: 'exists', res: {
        total: number;
        new: number;
    }): boolean;
    emit(event: 'expunge', res: number): boolean;
    emit(event: 'close', had_err: boolean): boolean;
    emit(event: 'end'): boolean;
    emit(event: 'timeout'): boolean;
    emit(event: 'message', msg: Buffer): boolean;
    emit(event: 'mail', err: any, data: {
        uid: number;
        mail: ParsedMail;
    }): boolean;
    emit(event: 'destroy'): boolean;
}
declare class MgImap extends EventEmitter implements MgImap {
    private options;
    private socket?;
    socketTimeout: number;
    private state?;
    private tagHandlerMap;
    private tagNum;
    private cmdQueue;
    private currCmd;
    private parser?;
    private searchUids;
    private caps;
    private idling;
    private logined;
    private box;
    constructor(opts: MgImapOptions);
    connect(): Promise<void>;
    /**
     * 发送指令
     * @param cmd
     * @param callback
     */
    sendCmd(cmd: string, callback?: (res: TagResponse) => void): void;
    /**
     * 登录
     * @returns
     */
    login(): Promise<boolean>;
    ID(identification: any): Promise<unknown>;
    /**
     * 选择邮箱文件夹
     * @param name
     * @param readOnly
     * @param callback
     */
    openBox(name: string, readOnly?: boolean): Promise<OpenBoxResponse>;
    /**
     * 用uid搜索邮箱
     * @param range ALL 100:200, 100:*
     */
    searchUid(range: string): Promise<number[]>;
    /**
     * 条件查询
     */
    search(criteria: any): Promise<number[]>;
    /**
     * 读取uid的邮件内容
     * @param range
     */
    fetchUid(range: number[]): Promise<any>;
    /**
     * 与邮箱服务器保持连接，但服务器也有可能主动关闭
     * @returns
     */
    noop(): Promise<boolean>;
    /**
     * 退出
     * @returns
     */
    logout(): Promise<boolean>;
    /**
     * 开始监听IDLE
     * @returns
     */
    idel(): Promise<boolean>;
    /**
     * 邮箱是否支持IDEL，IDEL可以实时获取邮箱状态
     * @returns
     */
    hasIdel(): boolean;
    isLogin(): boolean;
    private startTTLS;
    private capability;
    private createTLS;
    destroy(): void;
    private handleConnect;
    private initParser;
    private setSocketEvent;
}
export { MgImap, MgImapOptions, TagResponse, UntaggedResponse, OpenBoxResponse, ParsedMail };
