# sqlite
My standard use of SQLite

Uses `better-sqlite3` as a peer dependency

## Database
```
import Database from '@ludlovian/sqlite'

const db = new Database(file, options)
```

The default export. A class encapsulating the database.

Arguments:
- `file` - the filename, or `""` or `:memory:`
- `options` - the options, see below

### Options

On creation you can offer the following
- `createDDL` - DDL to be run if the file is being created.
- `runtimeDDL` - DDL to be run everytime you open it
- `checkSchema` - if given, this will check that `version` in `_schema` matches

Any DDL used is prettied before being run

### ._db

Gives you access to the underlying `better-sqlite3` database.

### ._inTransaction

Are we in a transaction (managed by us)

### .close

Closes the database.

### read(viewName, whereParams) => record

Selects the first row from a named view. The where params if given are an object.
Also synonymed to `.get`

Returns an object, or null-ish

### readAll(viewName, whereParams) => [record]

Like `.read` but gets all the rows as an array.

Synonym with `.all`

### update(spName, params)

Calls a stored proc (realy a view with an insert trigger)

### exec(sql)

Calls a single arbitrary SQL statement. Best to avoid.

### transaction(function)

Calls the specified function inside a sync transaction, coping with
rollbacks as needed.

### asyncTransaction(ms, function)

Calls the specified async function, committing regularly every `ms` milliseconds.

Any failure will only rollbaack to the last commit.

### notify(callback) => disposeFunction

Sets up notification - after every `update`.
