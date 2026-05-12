"""Legacy data-holder classes with trivial __init__ assignments."""


class User:
    def __init__(self, id, name, email):
        self.id = id
        self.name = name
        self.email = email


class Address:
    def __init__(self, street, city, zip):
        self.street = street
        self.city = city
        self.zip = zip
