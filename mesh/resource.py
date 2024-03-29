import re
from textwrap import dedent
from types import ClassType

from mesh.constants import *
from mesh.exceptions import *
from mesh.request import *
from mesh.util import identify_class, import_object, pull_class_dict, set_function_attr
from scheme import *

__all__ = ('Configuration', 'Controller', 'Resource', 'Subresource')

class Configuration(object):
    """A resource configuration scheme.

    :param dict standard_requests: Optional, default is ``None``; a ``dict`` mapping
        request names to callables which will generate a standard request for a given
        resource. The callables should take a single :class:`Resource` argument.

    :param list validated_requests: Optional, default is ``None``; a ``list`` indicating
        which standard requests provided by this configuration should be validated by
        validators which don't explicitly specify requests.

    :param Field id_field: Optional, default is ``None``; a :class:`mesh.schema.Field`
        which will serve as the unique identifier field for resources associated with
        this configuration which do not themselves declare an identifier field. If not
        specified, a :class:`mesh.schema.Integer` field with a name of ``id`` will be
        constructed for this configuration.

    :param class default_controller: Optional, default is ``None``; a subclass of
        :class:`Controller` which will be used as the base class for automatically
        generated mock controllers under this configuration.
    """

    def __init__(self, standard_requests=None, default_requests=None, validated_requests=None,
            id_field=None, default_controller=None):

        self.default_controller = default_controller or Controller
        self.default_requests = default_requests or []
        self.id_field = id_field or Integer(name='id', nonnull=True)
        self.standard_requests = standard_requests or {}
        self.validated_requests = validated_requests or []

    def create_controller(self, resource):
        """Creates a mock controller for ``resource``."""

        return type('%sController' % resource.__name__, (self.default_controller,), {
            'configuration': self,
            'resource': resource,
            'version': (resource.version, 0),
        })

def associate_resource_version(resource):
    if resource.version is None:
        return
    elif resource.version == 1:
        resource.versions = {1: resource}
        return
    elif resource.version not in resource.versions:
        resource.versions[resource.version] = resource
    else:
        raise SpecificationError('cannot declare duplicate version of %r' % resource)

class ResourceMeta(type):
    ATTRS = ('abstract', 'composite_key', 'configuration', 'name', 'version')

    def __new__(metatype, name, bases, namespace):
        asis = namespace.pop('__asis__', False)
        if asis:
            resource = type.__new__(metatype, name, bases, namespace)
            associate_resource_version(resource)
            return resource

        base_class = None
        if namespace.get('abstract', False):
            base_class = bases[0]
            if len(bases) > 1 or base_class.name is not None:
                raise SpecificationError('abstract resource %r may only inherit from a single'
                    ' abstract base resource' % name)
        else:
            for candidate in bases:
                if getattr(candidate, 'abstract', False):
                    continue
                elif base_class is None:
                    base_class = candidate
                else:
                    raise SpecificationError('concrete resource %r must inherit from only one'
                        'concrete resource' % name)

        if not base_class:
            raise SpecificationError('resource %r must inherit from exactly one non-abstract '
                'base resource' % name)

        configuration = getattr(base_class, 'configuration', None)
        if not configuration:
            configuration = namespace.get('configuration', None)
        if not configuration:
            return type.__new__(metatype, name, (base_class,), namespace)
        elif not isinstance(configuration, Configuration):
            raise SpecificationError('invalid configuration')

        schema = namespace.pop('schema', {})
        if isinstance(schema, (type, ClassType)):
            schema = pull_class_dict(schema)
        if not isinstance(schema, dict):
            raise SpecificationError('resource %r has an invalid schema' % name)

        removed_fields = set()
        for attr in schema.keys():
            if isinstance(schema[attr], Field):
                schema[attr].name = attr
            else:
                if schema[attr] is None:
                    removed_fields.add(attr)
                del schema[attr]

        requested_requests = namespace.pop('requests', None)
        if isinstance(requested_requests, basestring):
            requested_requests = requested_requests.split(' ')
        if requested_requests is None:
            requested_requests = configuration.default_requests

        declared_requests = {}
        removed_attrs = set()

        for attr in namespace.keys():
            if attr not in metatype.ATTRS and not attr.startswith('_'):
                if isinstance(namespace[attr], (type, ClassType)):
                    declared_requests[attr] = namespace.pop(attr)
                elif namespace[attr] is None:
                    removed_attrs.add(attr)
                    namespace.pop(attr)

        resource = type.__new__(metatype, name, (base_class,), namespace)
        if resource.version is not None:
            if not (isinstance(resource.version, int) and resource.version >= 1):
                raise SpecificationError('resource %r declares an invalid version' % name)

        resource.requests = {}
        resource.schema = {}
        resource.subresources = {}
        resource.validators = {}

        inherited_requests = set()
        for base in reversed(bases):
            if hasattr(base, 'schema'):
                resource.schema.update(base.schema)
                resource.subresources.update(base.subresources)
                resource.validators.update(base.validators)
                for name, request in base.requests.iteritems():
                    inherited_requests.add(request)
                    resource.requests[name] = request

        resource.schema.update(schema)
        for name in removed_fields:
            if name in resource.schema:
                del resource.schema[name]

        if isinstance(resource.composite_key, basestring):
            resource.composite_key = resource.composite_key.split(' ')

        id_field = configuration.id_field
        if id_field.name in resource.schema:
            resource.schema[id_field.name].is_identifier = True
        elif id_field.name not in removed_fields:
            resource.schema[id_field.name] = id_field.clone(is_identifier=True)
        resource.id_field = resource.schema.get(id_field.name)

        for name, request in declared_requests.iteritems():
            resource.requests[name] = Request.construct(resource, request)

        for attr, value in namespace.iteritems():
            if isinstance(value, Subresource):
                value.name = attr
                resource.subresources[attr] = value
            elif isinstance(value, classmethod):
                value = getattr(resource, attr)
                if getattr(value, '__validates__', False):
                    resource.validators[value.__name__] = value
                    delattr(resource, value.__name__)

        resource.description = dedent(resource.__doc__ or '')
        if resource.name is None:
            associate_resource_version(resource)
            return resource

        if requested_requests:
            for name in requested_requests:
                constructor = configuration.standard_requests.get(name)
                if constructor:
                    request = resource.requests.get(name)
                    if request and request in inherited_requests and request.auto_constructed:
                        request = None
                    if not request:
                        request = constructor(resource)
                        if request:
                            resource.requests[name] = request
                else:
                    raise SpecificationError('resource %r requests unknown standard request %r'
                        % (resource.name, name))

        for collection in (resource.requests, resource.validators):
            for name in collection.keys():
                if name in removed_attrs:
                    del collection[name]

        for validator in resource.validators.itervalues():
            if validator.requests is None:
                set_function_attr(validator, 'requests', configuration.validated_requests)
            for request_name in validator.requests:
                if request_name in resource.requests:
                    resource.requests[request_name].validators.append(validator)

        associate_resource_version(resource)
        return resource

    def __getattr__(resource, name):
        requests = type.__getattribute__(resource, 'requests')
        if requests is None:
            raise AttributeError(name)

        target = requests.get(name)
        if target:
            get_request = lambda a, b: target
        else:
            get_request = resource.configuration.standard_requests.get(name)
            if not get_request:
                raise AttributeError(name)

        return type(name, (object,), {
            'get_request': staticmethod(get_request)
        })

    def __getitem__(resource, version):
        return resource.versions[version]

    def __repr__(resource):
        if resource.name:
            return 'Resource:%s(name=%s, version=%s)' % (resource.__name__,
                resource.name, resource.version)
        else:
            return 'Resource:%s' % resource.__name__

    def __str__(resource):
        if resource.name:
            return '%s:%d' % (resource.name, resource.version)
        else:
            return resource.__name__

    @property
    def maximum_version(resource):
        return max(resource.versions.keys())

    @property
    def minimum_version(resource):
        return min(resource.versions.keys())

    @property
    def title(resource):
        chars = []
        for char in resource.__name__:
            if char.isupper():
                chars.append(' ')
            chars.append(char)
        return ''.join(chars).strip()

    def describe(resource, controller, path, verbose=False):
        if controller:
            version = controller.version
        else:
            version = (resource.version, 0)

        description = {
            '__subject__': 'resource',
            'id': '%s/%s' % ('/'.join(path), resource.name),
            'classname': resource.__name__,
            'composite_key': resource.composite_key,
            'controller': identify_class(controller),
            'name': resource.name,
            'title': resource.title,
            'description': resource.description,
            'resource': identify_class(resource),
            'version': version,
        }

        description['schema'] = {}
        for name, field in resource.schema.iteritems():
            description['schema'][name] = field.describe(verbose=verbose)

        prefix = '/%s/' % '/'.join(path)

        description['requests'] = {}
        for name, request in resource.requests.iteritems():
            description['requests'][name] = request.describe(prefix, verbose)

        return description

    def filter_schema(resource, exclusive=False, **params):
        schema = {}
        for name, field in resource.schema.iteritems():
            field = field.filter(exclusive, **params)
            if field:
                schema[name] = field
        return schema

    def mirror_schema(resource, exclude=None):
        if isinstance(exclude, basestring):
            exclude = exclude.split(' ')

        schema = {}
        for name, field in resource.schema.iteritems():
            if not exclude or name not in exclude:
                schema[name] = field.clone()
        return schema

    def reconstruct(resource, description):
        namespace = {
            '__asis__': True,
            'composite_key': description.get('composite_key'),
            'name': description['name'],
            'requests': {},
            'schema': {},
            'validators': {},
            'version': description['version'][0]}

        schema = description.get('schema')
        if isinstance(schema, dict):
            for name, field in schema.iteritems():
                namespace['schema'][name] = Field.reconstruct(field)
        
        resource = type(str(description['title']), (resource,), namespace)
        resource.id_field = resource.schema.get(resource.configuration.id_field.name)

        requests = description.get('requests')
        if isinstance(requests, dict):
            for name, request in requests.iteritems():
                namespace['requests'][name] = Request.reconstruct(resource, request)

        return resource

class Resource(object):
    """A resource definition.
    
    """

    __metaclass__ = ResourceMeta
    configuration = None

    abstract = False
    composite_key = None
    name = None
    version = None

class ControllerMeta(type):
    def __new__(metatype, name, bases, namespace):
        controller = type.__new__(metatype, name, bases, namespace)
        
        resource = controller.resource
        if resource is not None:
            version = controller.version
            if not issubclass(resource, Resource):
                raise SpecificationError('controller %r specifies an invalid resource' % name)
            if not (isinstance(version, tuple) and len(version) == 2 and version[0] >= 1 and version[1] >= 0):
                raise SpecificationError('controller %r specifies an invalid version: %r' % (name, version))
            if version[0] in resource.versions:
                resource = controller.resource = resource.versions[version[0]]
            else:
                raise SpecificationError('controller %r specifies an unknown version %r of resource %r'
                    % (name, version[0], resource.name))
        elif controller.version is not None:
            raise SpecificationError('abstract controller %r must not specify a version' % name)
        else:
            return controller

        controller.requests = {}
        for request in resource.requests.iterkeys():
            implementation = getattr(controller, request, None)
            if implementation:
                controller.requests[request] = implementation

        versions = getattr(controller, 'versions', None)
        if versions is None:
            versions = controller.versions = {}

        if controller.version in versions:
            raise SpecificationError('duplicate controller version')
        elif versions:
            resources = set([resource.name])
            resources |= set(version.resource.name for version in versions.itervalues())
            if len(resources) != 1:
                raise SpecificationError('mismatching resources')

        versions[controller.version] = controller
        controller.version_string = '%d.%d' % controller.version

        controller.__construct__()
        return controller

    def __repr__(controller):
        name = controller.__name__
        if controller.resource:
            return 'Controller:%s(resource=%s, version=%s)' % (name, controller.resource.name,
                controller.version_string)
        else:
            return 'Controller:%s' % name

    @property
    def maximum_version(controller):
        return max(controller.versions.keys())

    @property
    def minimum_version(controller):
        return min(controller.versions.keys())

class Controller(object):
    """A resource controller."""

    __metaclass__ = ControllerMeta

    resource = None
    version = None

    @classmethod
    def __construct__(cls):
        pass

    def acquire(self, subject):
        """Acquires and returns the backend instance for the implemented resource identified
        by ``subject``. The framework treats both ``subject`` and the returned value as
        opaque."""
        raise NotImplementedError()

    def dispatch(self, definition, request, response, subject, data):
        """Dispatches a request to this controller.
        """

        implementation = self.requests.get(definition.name)
        if implementation:
            content = implementation(self, request, response, subject, data)
            if content and content is not response:
                response(content)
        elif not self._dispatch_request(definition, request, response, subject, data):
            raise ValueError('no implementation available for %s' % definition.name)

    def _dispatch_request(self, definition, request, response, subject, data):
        return False

class Subresource(object):
    """A subresource."""

    def __init__(self, resource, requests=None, name=None):
        if isinstance(requests, basestring):
            requests = requests.split(' ')

        self.name = name
        self.requests = requests
        self.resource = resource
