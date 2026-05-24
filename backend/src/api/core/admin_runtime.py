import sys
from src.api.domains.admin import runtime as _module

sys.modules[__name__] = _module
