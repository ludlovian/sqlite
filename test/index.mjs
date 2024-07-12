import { suite, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { execSync } from 'node:child_process'

import Database from '../src/index.mjs'

suite('sqlite', { concurrency: false }, () => {
  const dbFile = 'test/test.db'
  let db
  before(() => {
    execSync(`rm -f ${dbFile}`)
    const ddl = `
      create table _Schema (id integer primary key, version integer);
      insert or replace into _Schema values(0, 1);

      create table foo (bar, baz);
      create table foobar (unused);
      create view boofar(bar,baz) as
        select 12, 'fizz' union all select 13, 'buzz';
    `
    db = new Database(dbFile, { createDDL: ddl, checkSchema: 1 })
  })
  after(() => {
    if (db) db.close()
    execSync(`rm -f ${dbFile}`)
  })

  test('creation', () => {
    assert(db instanceof Database)
    assert(db._db.open)
  })

  test('read a view', () => {
    let exp
    let act

    exp = { bar: 12, baz: 'fizz' }
    act = db.get('boofar')
    assert.deepStrictEqual(act, exp)

    exp = [
      { bar: 12, baz: 'fizz' },
      { bar: 13, baz: 'buzz' }
    ]
    act = db.all('boofar')
    assert.deepStrictEqual(act, exp)

    exp = { bar: 13, baz: 'buzz' }
    act = db.get('boofar', { bar: 13 })
    assert.deepStrictEqual(act, exp)
  })

  test('update by inserting', () => {
    db.exec('begin transaction')

    db.update('foo', { bar: 12, baz: 'fizz' })
    db.update('foo', { bar: 13, baz: 'buzz' })

    const exp = [
      { bar: 12, baz: 'fizz' },
      { bar: 13, baz: 'buzz' }
    ]
    const act = db.all('foo')
    assert.deepStrictEqual(act, exp)

    db.exec('delete from foo')
    db.exec('commit')
  })

  test('update by inserting to non-parameter view', () => {
    db.exec('begin transaction')

    db.update('foobar')
    const exp = { unused: null }
    const act = db.get('foobar')
    assert.deepStrictEqual(act, exp)

    db.exec('delete from foobar')
    db.exec('commit')
  })

  test('prepare statements', () => {
    db.exec('begin transaction')
    let sql
    let stmt

    sql = 'insert into foo(bar, baz) values(?, ?)'
    stmt = db.prepare(sql)
    stmt.run(12, 'fizz')
    stmt.run(13, 'buzz')

    sql = 'select count(*) as count from foo'
    stmt = db.prepare(sql)
    assert.strictEqual(stmt.get().count, 2)
    assert.strictEqual(stmt.all().length, 1)
    assert.strictEqual(stmt.all()[0].count, 2)

    db.exec('delete from foo')
    db.exec('commit')
  })

  test('read with SQL not views', () => {
    const sql = 'select * from boofar order by bar'
    const exp = [
      { bar: 12, baz: 'fizz' },
      { bar: 13, baz: 'buzz' }
    ]
    const act = db.all(sql)
    assert.deepStrictEqual(act, exp)
  })

  test('update with SQL not views', () => {
    db.exec('begin transaction')
    const sql = 'insert into foo(bar, baz) values($bar, $baz)'

    db.update(sql, { bar: 12, baz: 'fizz' })
    db.update(sql, { bar: 13, baz: 'buzz' })

    const exp = [
      { bar: 12, baz: 'fizz' },
      { bar: 13, baz: 'buzz' }
    ]
    const act = db.all('foo')
    assert.deepStrictEqual(act, exp)

    db.exec('delete from foo')
    db.exec('commit')
  })

  test('sync transactions', () => {
    const result = db.transaction(() => {
      db.update('foo', { bar: 12, baz: 'fizz' })
      assert(db._inTransaction)
      db.transaction(() => {
        db.update('foo', { bar: 13, baz: 'buzz' })
        assert(db._inTransaction)
      })
      db.update('foo', { bar: 14, baz: 'bozz' })
      assert(db._inTransaction)

      const count = db.all('foo').length
      assert.strictEqual(count, 3)

      db.exec('delete from foo')
      return 17
    })
    assert(!db._inTransaction)
    const count = db.all('foo').length
    assert.strictEqual(count, 0)
    assert.strictEqual(result, 17)
  })

  test('async transactions', async () => {
    const result = await db.asyncTransaction(250, async () => {
      db.update('foo', { bar: 12, baz: 'fizz' })
      assert(db._inTransaction)
      await db.asyncTransaction(1000, async () => {
        db.update('foo', { bar: 13, baz: 'buzz' })
      })
      assert(db._inTransaction)
      await sleep(300)
      assert(!db._inTransaction)
      db.update('foo', { bar: 14, baz: 'bozz' })
      assert(db._inTransaction)

      const count = db.all('foo').length
      assert.strictEqual(count, 3)

      db.exec('delete from foo')
      return 17
    })
    assert(!db._inTransaction)
    const count = db.all('foo').length
    assert.strictEqual(count, 0)
    assert.strictEqual(result, 17)
  })

  test('sync transaction fails', () => {
    assert.throws(
      () =>
        db.transaction(() => {
          db.update('foo', { bar: 12, baz: 'fizz' })
          throw new Error('foobar')
        }),
      /foobar/
    )
    assert(!db.inTransaction)
    const count = db.all('foo').length
    assert.strictEqual(count, 0)
  })

  test('async transaction fails', async () => {
    await assert.rejects(
      db.asyncTransaction(500, async () => {
        db.update('foo', { bar: 12, baz: 'fizz' })
        assert(db._inTransaction)
        await sleep(10)
        throw new Error('foobar')
      }),
      /foobar/
    )
    assert(!db._inTransaction)
    const count = db.all('foo').length
    assert.strictEqual(count, 0)
  })

  test('notify', () => {
    db.transaction(() => {
      const calls = []
      const onUpdate = (...args) => calls.push(args)
      const remove = db.notify(onUpdate)

      db.update('foo', { bar: 12, baz: 'fizz' })
      db.update('foo', { bar: 13, baz: 'buzz' })

      const exp = [
        ['foo', { bar: 12, baz: 'fizz' }],
        ['foo', { bar: 13, baz: 'buzz' }]
      ]
      assert.deepStrictEqual(calls, exp)
      remove()
      db.exec('delete from foo')
    })
  })

  test('autoCommit', async () => {
    db.autoCommit = 500
    db.autoCommit = 500 // do it again
    db.autoCommit = 250 // and change it

    db.update('foo', { bar: 12, baz: 'fizz' })

    assert(db._inTransaction)

    db.update('foo', { bar: 13, baz: 'buzz' })
    db.update('foo', { bar: 14, baz: 'bozz' })
    db.exec('delete from foo')

    assert(db._inTransaction)

    db.autoCommit = 0
    assert(!db._inTransaction)
  })

  test('bad schema', () => {
    const runtimeDDL = 'update _schema set version=17'
    assert.throws(
      () =>
        new Database(dbFile, {
          runtimeDDL,
          checkSchema: 2
        }),
      /Invalid schema/
    )
  })
})
