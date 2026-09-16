'use strict';

const handler = require('../../api/index.js');
const http = require('node:http');
const { Readable } = require('node:stream');

exports.handler = async function (event, context) {
  const req = new Readable({
    read() {
      if (event.body) {
        this.push(event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body);
      }
      this.push(null);
    }
  });

  const queryParams = event.queryStringParameters || {};
  const queryStr = Object.keys(queryParams).length
    ? '?' + new URLSearchParams(queryParams).toString()
    : '';

  req.url = (event.path || '/') + queryStr;
  req.method = event.httpMethod || 'GET';
  req.headers = {};
  if (event.headers) {
    for (const [key, val] of Object.entries(event.headers)) {
      req.headers[key.toLowerCase()] = val;
    }
  }

  let statusCode = 200;
  const headers = {};
  const chunks = [];

  const res = new http.ServerResponse(req);

  res.setHeader = (name, value) => {
    headers[name.toLowerCase()] = String(value);
  };
  res.getHeader = (name) => headers[name.toLowerCase()];
  res.removeHeader = (name) => {
    delete headers[name.toLowerCase()];
  };

  res.writeHead = (code, responseHeaders) => {
    statusCode = code;
    if (responseHeaders) {
      for (const [k, v] of Object.entries(responseHeaders)) {
        res.setHeader(k, v);
      }
    }
  };

  res.write = (chunk) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  };

  res.end = (chunk) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  };

  await handler(req, res);

  const bodyBuffer = Buffer.concat(chunks);
  const isText = /text|json|javascript|css|xml|html/i.test(headers['content-type'] || '');

  return {
    statusCode: res.statusCode || statusCode,
    headers,
    body: isText ? bodyBuffer.toString('utf8') : bodyBuffer.toString('base64'),
    isBase64Encoded: !isText
  };
};
