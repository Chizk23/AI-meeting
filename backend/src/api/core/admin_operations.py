import sys
from src.api.domains.admin import operations as _module

sys.modules[__name__] = _module
