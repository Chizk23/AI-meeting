import sys
from src.api.domains.organizations import invitations as _module

sys.modules[__name__] = _module
