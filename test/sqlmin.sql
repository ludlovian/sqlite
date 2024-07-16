export default `
  begin transaction;

-- a tes tof cleaning and minimising
    create temp table foo(
      bar     integer primary key,
      baz     text,
      boz     real,
      unique (baz, boz)
    );

  commit;

-- vim: ft=sql ts=2:sts=2:sw=2:et
`
