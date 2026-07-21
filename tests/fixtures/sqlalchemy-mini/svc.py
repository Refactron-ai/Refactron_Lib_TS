class User:
    active = True


def tested_query(session):
    return session.query(User).filter(User.active == True).all()


def untested_query(session):
    return session.query(User).filter(User.active == False).all()
