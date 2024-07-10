import { suite, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { execSync } from 'node:child_process'

import Database from '../src/index.mjs'

process.setMaxListeners(50)

suite('sqlite', { concurrency: false }, () => {
  const dbFile = 'test/test.db'
  before(() => execSync(`rm -f ${dbFile}`))
  after(() => execSync(`rm -f ${dbFile}`))

  test('creation', () => {
    const db = new Database(dbFile, {
      createDDL: `
        create table _Schema (
          id integer primary key check (id = 0),
          version integer
        );
        insert or replace into _Schema values(0,1);
      `,
      checkSchema: 1
    })

    db.close()
  })

  test('read a view', () => {
    const db = new Database(dbFile, {
      runtimeDDL: `
        create view if not exists foo
          (bar, baz)
        AS
          select 12, 'fizz'
          union all
          select 13, 'buzz'
        ;
      `
    })
    db._db.exec('begin transaction')

    let exp
    let act
    exp = { bar: 12, baz: 'fizz' }
    act = db.read('foo')
    assert.deepStrictEqual(act, exp)

    exp = [
      { bar: 12, baz: 'fizz' },
      { bar: 13, baz: 'buzz' }
    ]
    act = db.readAll('foo')
    assert.deepStrictEqual(act, exp)

    exp = { bar: 13, baz: 'buzz' }
    act = db.read('foo', { bar: 13 })
    assert.deepStrictEqual(act, exp)

    db._db.exec('drop view foo')
    db._db.exec('commit')
    db.close()
  })

  test('update by inserting', () => {
    const db = new Database(dbFile)
    db.exec('begin transaction')
    db.exec('create table foo(bar,baz)')

    db.update('foo', { bar: 12, baz: 'fizz' })
    db.update('foo', { bar: 13, baz: 'buzz' })

    const exp = [
      { bar: 12, baz: 'fizz' },
      { bar: 13, baz: 'buzz' }
    ]
    const act = db.readAll('foo')
    assert.deepStrictEqual(act, exp)

    db.exec('drop table foo')
    db.exec('commit')
    db.close()
  })

  test('update by inserting to non-parameter view', () => {
    const db = new Database(dbFile)
    db.exec('begin transaction')
    db.exec('create table foo (unused)')
    db.update('foo')
    const exp = { unused: null }
    const act = db.read('foo')
    assert.deepStrictEqual(act, exp)
    db.exec('drop table foo')
    db.exec('commit')
    db.close()
  })

  test('async transaction', async () => {
    const db = new Database(dbFile)
    db.exec('create table foo (bar, baz)')
    await db.asyncTransaction(250, async () => {
      db.update('foo', { bar: 12, baz: 'fizz' })
      assert(db._inTransaction)
      db.update('foo', { bar: 13, baz: 'buzz' })
      assert(db._inTransaction)
      await sleep(300)
      assert(!db._inTransaction)
      db.update('foo', { bar: 14, baz: 'bozz' })
      assert(db._inTransaction)
    })
    assert(!db._inTransaction)
    const count = countFoo(db)
    assert.strictEqual(count, 3)
    db.exec('drop table foo')
    db.close()
  })

  test('sync transaction fails', () => {
    const db = new Database(dbFile)
    db.exec('create table foo (bar, baz)')

    assert.throws(
      () =>
        db.transaction(() => {
          db.update('foo', { bar: 12, baz: 'fizz' })
          throw new Error('foobar')
        }),
      /foobar/
    )
    assert(!db.inTransaction)

    const count = countFoo(db)
    assert.strictEqual(count, 0)

    db.exec('drop table foo')
    db.close()
  })

  test('async transaction fails', async () => {
    const db = new Database(dbFile)
    db.exec('create table foo (bar, baz)')

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

    const count = countFoo(db)
    assert.strictEqual(count, 0)

    db.exec('drop table foo')
    db.close()
  })

  test('nest sync transactions', () => {
    const db = new Database(dbFile)
    db.exec('create table foo (bar, baz)')

    db.transaction(() => {
      db.update('foo', { bar: 12, baz: 'fizz' })
      db.transaction(() => {
        db.update('foo', { bar: 13, baz: 'buzz' })
      })
    })

    const count = countFoo(db)
    assert.strictEqual(count, 2)

    db.exec('drop table foo')
    db.close()
  })

  test('nest async transactions', async () => {
    const db = new Database(dbFile)
    db.exec('create table foo (bar, baz)')

    await db.asyncTransaction(500, async () => {
      db.update('foo', { bar: 12, baz: 'fizz' })
      await db.asyncTransaction(500, async () => {
        db.update('foo', { bar: 13, baz: 'buzz' })
      })
    })

    const count = countFoo(db)
    assert.strictEqual(count, 2)

    db.exec('drop table if exists foo')
    db.close()
  })

  test('bad schema', () => {
    assert.throws(
      () =>
        new Database(dbFile, {
          checkSchema: 2
        }),
      /Invalid schema/
    )
  })

  test('notify', () => {
    const db = new Database(dbFile)
    db.exec('create table foo(bar,baz)')
    const calls = []
    const onUpdate = (...args) => calls.push(args)
    const remove = db.notify(onUpdate)

    db.transaction(() => {
      db.update('foo', { bar: 12, baz: 'fizz' })
      db.update('foo', { bar: 13, baz: 'buzz' })
    })

    const exp = [
      ['foo', { bar: 12, baz: 'fizz' }],
      ['foo', { bar: 13, baz: 'buzz' }]
    ]
    assert.deepStrictEqual(calls, exp)
    remove()

    db.exec('drop table foo')
    db.close()
  })

  test('sync transaction returns value', () => {
    const db = new Database(dbFile)
    db._db.exec('create table foo(bar,baz)')

    const exp = 17
    const act = db.transaction(() => {
      db.update('foo', { bar: 12, baz: 'fizz' })
      db.update('foo', { bar: 13, baz: 'buzz' })
      return 17
    })

    assert.deepStrictEqual(act, exp)

    db.exec('drop table foo')
    db.close()
  })

  test('async transaction returns value', async () => {
    const db = new Database(dbFile)
    db._db.exec('create table foo(bar,baz)')

    const exp = 17
    const act = await db.asyncTransaction(500, async () => {
      db.update('foo', { bar: 12, baz: 'fizz' })
      db.update('foo', { bar: 13, baz: 'buzz' })
      return 17
    })

    assert.deepStrictEqual(act, exp)

    db.exec('drop table foo')
    db.close()
  })
})

function countFoo (db) {
  const s = db._db.prepare('select count(*) from foo')
  return s.pluck().get()
}
