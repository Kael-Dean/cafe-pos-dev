from cuid2 import Cuid

_cuid = Cuid(length=24)


def new_cuid() -> str:
    return _cuid.generate()
