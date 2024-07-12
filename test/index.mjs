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
      create table schema (id integer primary key, version integer);
      insert or replace into schema values(0, 1);

      create table foo (bar integer, baz);
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

    db.run('foo', { bar: 12, baz: 'fizz' })
    db.run('foo', { bar: 13, baz: 'buzz' })

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

    db.run('foobar')
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

    db.run(sql, { bar: 12, baz: 'fizz' })
    db.run(sql, { bar: 13, baz: 'buzz' })

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
      db.run('foo', { bar: 12, baz: 'fizz' })
      assert(db._inTransaction)
      db.transaction(() => {
        db.run('foo', { bar: 13, baz: 'buzz' })
        assert(db._inTransaction)
      })
      db.run('foo', { bar: 14, baz: 'bozz' })
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
      db.run('foo', { bar: 12, baz: 'fizz' })
      assert(db._inTransaction)
      await db.asyncTransaction(1000, async () => {
        db.run('foo', { bar: 13, baz: 'buzz' })
      })
      assert(db._inTransaction)
      await sleep(300)
      assert(!db._inTransaction)
      db.run('foo', { bar: 14, baz: 'bozz' })
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
          db.run('foo', { bar: 12, baz: 'fizz' })
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
        db.run('foo', { bar: 12, baz: 'fizz' })
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

      db.run('foo', { bar: 12, baz: 'fizz' })
      db.run('foo', { bar: 13, baz: 'buzz' })

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

    db.run('foo', { bar: 12, baz: 'fizz' })

    assert(db._inTransaction)

    db.run('foo', { bar: 13, baz: 'buzz' })
    db.run('foo', { bar: 14, baz: 'bozz' })
    db.exec('delete from foo')

    assert(db._inTransaction)

    db.autoCommit = 0
    assert(!db._inTransaction)
  })

  test('bad schema', () => {
    const runtimeDDL = 'update schema set version=17'
    assert.throws(
      () =>
        new Database(dbFile, {
          runtimeDDL,
          checkSchema: 2
        }),
      /Invalid schema/
    )
  })

  test('trackChanges', () => {
    let sql
    sql =
      'create table changes(id integer primary key autoincrement,name,type,row,jd)'
    db.exec(sql)
    db.trackChanges('foo')

    sql = 'insert into foo(bar,baz) values($bar,$baz)'
    db.run(sql, { bar: 12, baz: 'fizz' })

    sql = 'update foo set baz=$newBaz where bar=$bar'
    db.run(sql, { bar: 12, baz: 'fizz', newBaz: 'bozz' })

    sql = 'delete from foo where bar=$bar'
    db.run(sql, { bar: 12 })

    sql = 'select name,type,row from changes order by id'
    const act = db.all(sql)

    const exp = [
      { name: 'foo', type: 0, row: '{"bar":12,"baz":"fizz"}' },
      { name: 'foo', type: 1, row: '{"bar":12,"baz":"fizz"}' },
      { name: 'foo', type: 2, row: '{"bar":12,"baz":"bozz"}' },
      { name: 'foo', type: 3, row: '{"bar":12,"baz":"bozz"}' }
    ]
    assert.deepStrictEqual(act, exp)
  })
})
