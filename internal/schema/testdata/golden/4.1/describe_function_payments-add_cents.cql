
CREATE FUNCTION payments.add_cents(a int, b int)
    CALLED ON NULL INPUT
    RETURNS int
    LANGUAGE java
    AS $$return a + b;$$;
