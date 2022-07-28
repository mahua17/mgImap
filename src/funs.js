const RE_NUM_RANGE = /^(?:[\d]+|\*):(?:[\d]+|\*)$/,
      RE_INTEGER = /^\d+$/,
      MONTHS = ['Jan', 'Feb', 'Mar',
              'Apr', 'May', 'Jun',
              'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

function buildSearchQuery(options, extensions, info, isOrChild) {
  var searchargs = '', err, val;
  for (var i = 0, len = options.length; i < len; ++i) {
    var criteria = (isOrChild ? options : options[i]),
        args = null,
        modifier = (isOrChild ? '' : ' ');
    if (typeof criteria === 'string')
      criteria = criteria.toUpperCase();
    else if (Array.isArray(criteria)) {
      if (criteria.length > 1)
        args = criteria.slice(1);
      if (criteria.length > 0)
        criteria = criteria[0].toUpperCase();
    } else
      throw new Error('Unexpected search option data type. '
                      + 'Expected string or array. Got: ' + typeof criteria);
    if (criteria === 'OR') {
      if (args.length !== 2)
        throw new Error('OR must have exactly two arguments');
      if (isOrChild)
        searchargs += 'OR (';
      else
        searchargs += ' OR (';
      searchargs += buildSearchQuery(args[0], extensions, info, true);
      searchargs += ') (';
      searchargs += buildSearchQuery(args[1], extensions, info, true);
      searchargs += ')';
    } else {
      if (criteria[0] === '!') {
        modifier += 'NOT ';
        criteria = criteria.substr(1);
      }
      switch(criteria) {
        // -- Standard criteria --
        case 'ALL':
        case 'ANSWERED':
        case 'DELETED':
        case 'DRAFT':
        case 'FLAGGED':
        case 'NEW':
        case 'SEEN':
        case 'RECENT':
        case 'OLD':
        case 'UNANSWERED':
        case 'UNDELETED':
        case 'UNDRAFT':
        case 'UNFLAGGED':
        case 'UNSEEN':
          searchargs += modifier + criteria;
        break;
        case 'BCC':
        case 'BODY':
        case 'CC':
        case 'FROM':
        case 'SUBJECT':
        case 'TEXT':
        case 'TO':
          if (!args || args.length !== 1)
            throw new Error('Incorrect number of arguments for search option: '
                            + criteria);
          val = buildString(args[0]);
          if (info && val[0] === '{')
            info.hasUTF8 = true;
          searchargs += modifier + criteria + ' ' + val;
        break;
        case 'BEFORE':
        case 'ON':
        case 'SENTBEFORE':
        case 'SENTON':
        case 'SENTSINCE':
        case 'SINCE':
          if (!args || args.length !== 1)
            throw new Error('Incorrect number of arguments for search option: '
                            + criteria);
          else if (!(args[0] instanceof Date)) {
            if ((args[0] = new Date(args[0])).toString() === 'Invalid Date')
              throw new Error('Search option argument must be a Date object'
                              + ' or a parseable date string');
          }
          searchargs += modifier + criteria + ' ' + args[0].getDate() + '-'
                        + MONTHS[args[0].getMonth()] + '-'
                        + args[0].getFullYear();
        break;
        case 'KEYWORD':
        case 'UNKEYWORD':
          if (!args || args.length !== 1)
            throw new Error('Incorrect number of arguments for search option: '
                            + criteria);
          searchargs += modifier + criteria + ' ' + args[0];
        break;
        case 'LARGER':
        case 'SMALLER':
          if (!args || args.length !== 1)
            throw new Error('Incorrect number of arguments for search option: '
                            + criteria);
          var num = parseInt(args[0], 10);
          if (isNaN(num))
            throw new Error('Search option argument must be a number');
          searchargs += modifier + criteria + ' ' + args[0];
        break;
        case 'HEADER':
          if (!args || args.length !== 2)
            throw new Error('Incorrect number of arguments for search option: '
                            + criteria);
          val = buildString(args[1]);
          if (info && val[0] === '{')
            info.hasUTF8 = true;
          searchargs += modifier + criteria + ' "' + escape(''+args[0])
                     + '" ' + val;
        break;
        case 'UID':
          if (!args)
            throw new Error('Incorrect number of arguments for search option: '
                            + criteria);
          validateUIDList(args);
          if (args.length === 0)
            throw new Error('Empty uid list');
          searchargs += modifier + criteria + ' ' + args.join(',');
        break;
        // Extensions ==========================================================
        case 'X-GM-MSGID': // Gmail unique message ID
        case 'X-GM-THRID': // Gmail thread ID
          if (extensions.indexOf('X-GM-EXT-1') === -1)
            throw new Error('IMAP extension not available for: ' + criteria);
          if (!args || args.length !== 1)
            throw new Error('Incorrect number of arguments for search option: '
                            + criteria);
          else {
            val = ''+args[0];
            if (!(RE_INTEGER.test(args[0])))
              throw new Error('Invalid value');
          }
          searchargs += modifier + criteria + ' ' + val;
        break;
        case 'X-GM-RAW': // Gmail search syntax
          if (extensions.indexOf('X-GM-EXT-1') === -1)
            throw new Error('IMAP extension not available for: ' + criteria);
          if (!args || args.length !== 1)
            throw new Error('Incorrect number of arguments for search option: '
                            + criteria);
          val = buildString(args[0]);
          if (info && val[0] === '{')
            info.hasUTF8 = true;
          searchargs += modifier + criteria + ' ' + val;
        break;
        case 'X-GM-LABELS': // Gmail labels
          if (extensions.indexOf('X-GM-EXT-1') === -1)
            throw new Error('IMAP extension not available for: ' + criteria);
          if (!args || args.length !== 1)
            throw new Error('Incorrect number of arguments for search option: '
                            + criteria);
          searchargs += modifier + criteria + ' ' + args[0];
        break;
        case 'MODSEQ':
          if (extensions.indexOf('CONDSTORE') === -1)
            throw new Error('IMAP extension not available for: ' + criteria);
          if (!args || args.length !== 1)
            throw new Error('Incorrect number of arguments for search option: '
                            + criteria);
          searchargs += modifier + criteria + ' ' + args[0];
        break;
        default:
          // last hope it's a seqno set
          // http://tools.ietf.org/html/rfc3501#section-6.4.4
          var seqnos = (args ? [criteria].concat(args) : [criteria]);
          if (!validateUIDList(seqnos, true)) {
            if (seqnos.length === 0)
              throw new Error('Empty sequence number list');
            searchargs += modifier + seqnos.join(',');
          } else
            throw new Error('Unexpected search option: ' + criteria);
      }
    }
    if (isOrChild)
      break;
  }
  return searchargs;
}

function validateUIDList(uids, noThrow) {
  for (var i = 0, len = uids.length, intval; i < len; ++i) {
    if (typeof uids[i] === 'string') {
      if (uids[i] === '*' || uids[i] === '*:*') {
        if (len > 1)
          uids = ['*'];
        break;
      } else if (RE_NUM_RANGE.test(uids[i]))
        continue;
    }
    intval = parseInt(''+uids[i], 10);
    if (isNaN(intval)) {
      var err = new Error('UID/seqno must be an integer, "*", or a range: '
                          + uids[i]);
      if (noThrow)
        return err;
      else
        throw err;
    } else if (intval <= 0) {
      var err = new Error('UID/seqno must be greater than zero');
      if (noThrow)
        return err;
      else
        throw err;
    } else if (typeof uids[i] !== 'number') {
      uids[i] = intval;
    }
  }
}

function buildString(str) {
  if (typeof str !== 'string')
    str = ''+str;

  if (hasNonASCII(str)) {
    var buf = Buffer.from(str, 'utf8');
    return '{' + buf.length + '}\r\n' + buf.toString('latin1');
  } else
    return '"' + escape(str) + '"';
}

function hasNonASCII(str) {
  for (var i = 0, len = str.length; i < len; ++i) {
    if (str.charCodeAt(i) > 0x7F)
      return true;
  }
  return false;
}

module.exports = {
  buildSearchQuery
}