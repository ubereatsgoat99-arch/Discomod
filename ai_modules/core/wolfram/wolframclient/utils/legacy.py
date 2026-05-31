_legacy = {"value": False}


def is_legacy_mode():
    return _legacy["value"]


def set_legacy_mode(mode=True):
    _legacy["value"] = mode
    return mode
