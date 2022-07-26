/// <reference types="node" />
/// <reference types="node" />
import { EventEmitter } from "events";
import * as tls from "tls";
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
export default class MgImap extends EventEmitter {
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
    login(): Promise<boolean | undefined>;
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
     * 读取uid的邮件内容
     * @param range
     */
    fetchUid(range: number[]): Promise<any>;
    /**
     * 与邮箱服务器保持连接，但服务器也有可能主动关闭
     * @returns
     */
    noop(): Promise<unknown>;
    /**
     * 退出
     * @returns
     */
    logout(): Promise<unknown>;
    /**
     * 开始监听IDLE
     * @returns
     */
    idel(): Promise<unknown>;
    /**
     * 邮箱是否支持IDEL，IDEL可以实时获取邮箱状态
     * @returns
     */
    hasIdel(): boolean;
    private startTTLS;
    private capability;
    private createTLS;
    destroy(): void;
    private handleConnect;
    private initParser;
    private setSocketEvent;
}
export {};
