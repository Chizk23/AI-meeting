import sys
from src.api.domains.meetings import tasks as _module

sys.modules[__name__] = _module
