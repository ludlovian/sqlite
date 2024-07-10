import process from 'node:process'
import fs from 'node:fs'
import SQLite3Database from 'better-sqlite3'
import Bouncer from '@ludlovian/bouncer'
import sqlmin from './sqlmin.mjs'

export default class Database {
  #db
  #stmts = {}
  #updateStmts = {}
  #readStmts = {}
  #commitMgr = {
    delay: 0,
    active: 0,
    dispose: undefined,
    bouncer: undefined
  }

  #handler = { pre: undefined, post: undefined }
  #hooks = { pre: [], post: [] }

  // --------------------------------------------------------------
  // Construction

  constructor (file, { createDDL, runtimeDDL, checkSchema } = {}) {
    const realFile = !!file && !file.startsWith(':')
    const fileExists = realFile && fs.existsSync(file)
    this.#db = new SQLite3Database(file)
    if (realFile && createDDL && !fileExists) {
      this.#db.exec(sqlmin(createDDL))
    }
    if (runtimeDDL) {
      this.#db.exec(sqlmin(runtimeDDL))
    }
    if (checkSchema) {
      const schema = this.read('_Schema')
      if (schema?.version !== checkSchema) {
        throw new Error('Invalid schema: ' + file)
      }
    }
    this.close = this.close.bind(this)
    process.on('exit', this.close)
  }

  // --------------------------------------------------------------
  // Getters & setters

  get _db () {
    return this.#db
  }

  get _inTransaction () {
    return this.#commitMgr.active
  }

  get autoCommit () {
    return this.#commitMgr.delay
  }

  set autoCommit (ms) {
    if (this.autoCommit === ms) return
    this.#commitMgr.delay = ms
    this.#stopAutoCommit()
    if (ms) this.#startAutoCommit()
  }

  // --------------------------------------------------------------
  // Public API

  close () {
    process.removeListener('exit', this.close)
    if (this.#db && this.#db.open) {
      this.#commit()
      this.#db.close()
    }
  }

  update (name, ...parms) {
    this.#handler.pre && this.#handler.pre(name, ...parms)
    const stmt = this.#getUpdateStmt(name)
    stmt.run(...parms)
    this.#handler.post && this.#handler.post(name, ...parms)
  }

  read (name, ...parms) {
    const stmt = this.#getReadStmt(name, ...parms)
    return stmt.get(...parms)
  }

  readAll (name, ...parms) {
    const stmt = this.#getReadStmt(name, ...parms)
    return stmt.all(...parms)
  }

  exec (sql, ...parms) {
    const stmt = this.#getStmt(sql)
    stmt.run(...parms)
  }

  transaction (fn) {
    if (this._inTransaction) return fn()
    let result
    this.#begin()
    try {
      result = fn()
      this.#commit()
    } catch (err) {
      this.#rollback()
      throw err
    }
    return result
  }

  async asyncTransaction (ms, fn) {
    if (this._inTransaction) return await fn()
    const oldAutoCommit = this.autoCommit
    this.autoCommit = ms
    try {
      const result = await fn()
      this.#commit()
      this.autoCommit = oldAutoCommit
      return result
    } catch (err) {
      this.#rollback()
      this.autoCommit = oldAutoCommit
      throw err
    }
  }

  notify (fn) {
    return this.#addUpdateHook('post', fn)
  }

  // --------------------------------------------------------------
  // Internal - Statement management

  #getReadStmt (name, parms = {}) {
    const cols = Object.keys(parms)
    const key = [name, ...cols].join(',')
    let stmt = this.#readStmts[key]
    if (stmt) return stmt
    let sql = `select * from ${name}`
    if (cols.length) {
      sql += ' where ' + cols.map(col => `${col}=:${col}`).join(' and ')
    }
    stmt = this.#readStmts[key] = this.#getStmt(sql)
    return stmt
  }

  #getUpdateStmt (name) {
    let stmt = this.#updateStmts[name]
    if (stmt) return stmt
    const colStmt = this.#getStmt(
      "select name from pragma_table_info(?) where name != 'unused' order by cid"
    )
    const cols = colStmt.all(name).map(({ name }) => name)
    let sql
    if (cols.length) {
      sql =
        `insert into ${name}(` +
        cols.join(',') +
        ')values(' +
        cols.map(col => ':' + col) +
        ')'
    } else {
      sql = `insert into ${name} values(null)`
    }
    stmt = this.#updateStmts[name] = this.#getStmt(sql)
    return stmt
  }

  #getStmt (sql) {
    let stmt = this.#stmts[sql]
    if (stmt) return stmt
    stmt = this.#stmts[sql] = this.#db.prepare(sql)
    return stmt
  }

  // --------------------------------------------------------------
  // Internal - Update hooks

  #addUpdateHook (type, hookFn) {
    this.#hooks[type].push(hookFn)
    if (!this.#handler[type]) {
      this.#handler[type] = (...args) =>
        this.#hooks[type].forEach(fn => fn(...args))
    }
    return () => this.#removeUpdateHook(type, hookFn)
  }

  #removeUpdateHook (type, hookFn) {
    this.#hooks[type] = this.#hooks[type].filter(fn => fn !== hookFn)
    if (!this.#hooks[type].length) this.#handler[type] = undefined
  }

  // --------------------------------------------------------------
  // Internal - Transaction

  #begin () {
    if (this.#commitMgr.active) return
    this.#getStmt('begin transaction').run()
    this.#commitMgr.active = true
  }

  #rollback () {
    // defensive
    /* c8 ignore next */
    if (!this.#commitMgr.active) return
    this.#getStmt('rollback').run()
    this.#commitMgr.active = false
  }

  #commit () {
    if (!this.#commitMgr.active) return
    this.#getStmt('commit').run()
    this.#commitMgr.active = false
  }

  #stopAutoCommit () {
    const mgr = this.#commitMgr
    this.#commit()
    mgr.bouncer?.cancel()
    mgr.dispose?.()
    mgr.bouncer = mgr.dispose = undefined
  }

  #startAutoCommit () {
    const mgr = this.#commitMgr
    // defensive
    /* c8 ignore next */
    if (!mgr.delay) return undefined

    const bouncer = (mgr.bouncer = new Bouncer({
      every: mgr.delay,
      leading: false,
      fn: () => this.#commit()
    }))
    mgr.dispose = this.#addUpdateHook('pre', () => {
      this.#begin()
      bouncer.fire()
    })
  }
}

Database.prototype.get = Database.prototype.read
Database.prototype.all = Database.prototype.readAll
