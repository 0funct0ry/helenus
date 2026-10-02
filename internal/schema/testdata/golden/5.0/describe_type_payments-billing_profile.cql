
CREATE TYPE payments.billing_profile (
    name text,
    home frozen<address>,
    points list<frozen<geo_point>>
);
