import sys
from src.api.domains.meetings import prompts as _module

sys.modules[__name__] = _module
