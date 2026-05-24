import sys
from src.api.domains.shared.user_payloads import *  # noqa: F401,F403

_module = sys.modules[__name__]
sys.modules[__name__] = sys.modules["src.api.domains.shared.user_payloads"]
for attr in dir(_module):
    if not attr.startswith("_"):
        setattr(sys.modules[__name__], attr, getattr(_module, attr))
