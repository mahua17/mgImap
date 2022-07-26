import { EventEmitter } from "events";

const CRLF = "\r\n",
  RE_TAGGED = /^A(\d+) (OK|NO|BAD) ?(?:\[([^\]]+)\] )?(.*)$/i,
  RE_BODYPART = /^BODY\[/,
  RE_SEQNO = /^\* (\d+)/,
  EMPTY_READCB = function (n: any) { },
  LITPLACEHOLDER = String.fromCharCode(0),
  RE_BODYLITERAL = /BODY\[(.*)\] \{(\d+)\}$/i,
  RE_LITERAL = /\{(\d+)\}$/,
  RE_PRECEDING = /^(?:\* |A\d+ |\+ ?)/,
  RE_SEARCH_MODSEQ = /^(.+) \(MODSEQ (.+?)\)$/i,
  RE_LISTCONTENT = /^\((.*)\)$/,
  RE_FETCHBODY = /^\* (\d+) FETCH (.+) BODY\[\] \{\d+\}/i,
  RE_FETCHBODY_UID = /UID (\d+)/i,
  RE_CONTINUE = /^\+(?: (?:\[([^\]]+)\] )?(.+))?$/i,
  RE_UNTAGGED =
    /^\* (?:(OK|NO|BAD|BYE|FLAGS|ID|LIST|XLIST|LSUB|SEARCH|STATUS|CAPABILITY|NAMESPACE|PREAUTH|SORT|THREAD|ESEARCH|QUOTA|QUOTAROOT)|(\d+) (EXPUNGE|FETCH|RECENT|EXISTS))(?:(?: \[([^\]]+)\])?(?: (.+))?)?$/i;

export default class Parser extends EventEmitter {
  private logger?: (...args: any[]) => any;

  private message: string = "";

  private body?: {
    uid?: number,
    size: number
    contents: string
  }

  constructor(logger?: (...args: any[]) => any) {
    super();
    this.logger = logger;
  }

  parse(data: Buffer) {
    const msg = data.toString("utf8");
    this.logger && this.logger("<=", msg);
    this.message += msg;
    this.handleMessage();
  }

  handleMessage() {
    if (!this.message) return;

    if (this.body) {
      const res = this.message.substring(0, this.body.size);
      this.body.size -= res.length;
      if (res !== "")
        this.message = this.message.substring(res.length);
      this.body.contents += res;
      if (this.body.size <= 0) {
        // fs.writeFileSync("./body.txt", this.body.contents);
        this.emit("body", this.body)
        this.body = undefined;
      }
    } else {
      const endIndex = this.message.indexOf(CRLF);
      if (endIndex === -1) return;
      const res = this.message.substring(0, endIndex);
      this.message = this.message.substring(endIndex + 2);
      if (RE_PRECEDING.test(res)) {
        const firstChar = res[0];
        if (firstChar === "*") this.resUntagged(res);
        else if (firstChar === "A") this.resTagged(res);
        else if (firstChar === "+") this.resContinue(res);
      } else {
        this.emit("other", res);
      }
    }

    process.nextTick(this.handleMessage.bind(this));
  }

  private resUntagged(msg: string) {
    let m;

    if ((m = RE_BODYLITERAL.exec(msg))) {
      const size = parseInt(m[2], 10);
      m = RE_FETCHBODY.exec(msg);
      let uid;
      if (m && m[2]) {
        const uidMatch = RE_FETCHBODY_UID.exec(m[2])
        uid = uidMatch ? parseInt(uidMatch[1], 10) : undefined
      }

      this.body = {
        uid,
        size,
        contents: ""
      }

    } else if ((m = RE_UNTAGGED.exec(msg))) {
      // console.log(m);
      let type, num, textCode, val;
      if (m[2] !== undefined) num = parseInt(m[2], 10);
      if (m[4] !== undefined) {
        textCode = m[4];
      }
      type = (m[1] || m[3]).toLowerCase();
      if (
        type === "flags" ||
        type === "search" ||
        type === "capability" ||
        type === "sort"
      ) {
        if (m[5]) {
          if (type === "search" && RE_SEARCH_MODSEQ.test(m[5])) {
            // CONDSTORE search response
            const p = RE_SEARCH_MODSEQ.exec(m[5]);
            if (p) {
              val = {
                results: p[1].split(" "),
                modseq: p[2],
              };
            }
          } else {
            if (m[5][0] === "(") val = RE_LISTCONTENT.exec(m[5])![1].split(" ");
            else val = m[5].split(" ");

            if (type === "search" || type === "sort")
              val = val.map(function (v) {
                return parseInt(v, 10);
              });
          }
        } else {
          val = [];
        }
      } else if (type === "thread") {
        // if (m[5])
        //   val = parseExpr(m[5], this._literals);
        // else{
        //   val = [];
        // }
      } else if (type === "list" || type === "lsub" || type === "xlist") {
        // val = parseBoxList(m[5], this._literals);
      } else if (type === "id") {
        // val = parseId(m[5], this._literals);
      } else if (type === "status") {
        // val = parseStatus(m[5], this._literals);
      } else if (type === "fetch") {
        // val = parseFetch.call(this, m[5], this._literals, num);
      } else if (type === "namespace") {
        // val = parseNamespaces(m[5], this._literals);
      } else if (type === "esearch") {
        // val = parseESearch(m[5], this._literals);
      } else if (type === "quota") {
        // val = parseQuota(m[5], this._literals);
      } else if (type === "quotaroot") {
        // val = parseQuotaRoot(m[5], this._literals);
      } else {
        val = m[5];
      }
      // this._literals = [];
      this.emit("untagged", {
        type: type,
        num: num,
        textCode: textCode,
        text: val,
      });
    } else if ((m = RE_LITERAL.exec(msg))) {
    } else {
    }
  }

  private resTagged(msg: string) {
    var m;
    if ((m = RE_LITERAL.exec(msg))) {
      // non-BODY literal -- buffer it
      this.message = this.message.replace(RE_LITERAL, LITPLACEHOLDER);
    } else if ((m = RE_TAGGED.exec(msg))) {
      this.emit("tagged", {
        result: m[2].toLowerCase(),
        tag: parseInt(m[1], 10),
        // textCode: m[3] ? parseTextCode(m[3], this._literals) : m[3],
        textCode: m[3],
        text: m[4],
      });
    } else {
      // this.buffer = "";
    }
  }

  private resContinue(msg: string) {
    var m = RE_CONTINUE.exec(msg),
      textCode,
      text;
    if (!m)
      return;

    text = m[2];

    if (m[1] !== undefined)
      textCode = m[1];

    this.emit('continue', {
      textCode: textCode,
      text: text
    });
  }
}
