
CREATE AGGREGATE payments.sum_cents(int)
    SFUNC add_cents
    STYPE int
    INITCOND 0;
