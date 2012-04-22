from threading import Thread, Event

try:
    import json
except ImportError:
    import simplejson as json

from unittest2 import TestCase

from mesh.bundle import *
from mesh.constants import *
from mesh.exceptions import *
from mesh.transport.base import *

from fixtures import *

class TestServerResponse(TestCase):
    def test(self):
        response = ServerResponse()()
        self.assertIs(response.status, None)
        self.assertIs(response.content, None)

        response = ServerResponse()(OK)
        self.assertEqual(response.status, OK)
        self.assertIs(response.content, None)

        response = ServerResponse()(OK, 'content')
        self.assertEqual(response.status, OK)
        self.assertEqual(response.content, 'content')

        response = ServerResponse()('content')
        self.assertIs(response.status, None)
        self.assertEqual(response.content, 'content')

class TestClient(TestCase):
    def test_global_clients(self):
        specification = Specification({'name': 'test', 'version': (1, 0), 'resources': {}})
        self.assertIs(Client.get_client(specification), None)

        client = Client(specification).register(False)
        self.assertIs(Client.get_client(specification), client)

        client.unregister(False)
        self.assertIs(Client.get_client(specification), None)

    def test_local_clients(self):
        specification = Specification({'name': 'test', 'version': (1, 0), 'resources': {}})
        client1 = Client(specification, {'id': 1})
        client2 = Client(specification, {'id': 2})
        guard = Event()

        def run(client, event):
            self.assertIs(Client.get_client(specification), None)
            client.register()
            event.set()
            guard.wait()

            self.assertIs(Client.get_client(specification), client)
            client.unregister()
            self.assertIs(Client.get_client(specification), None)

        e1 = Event()
        t1 = Thread(target=run, args=(client1, e1))
        t1.start()

        e2 = Event()
        t2 = Thread(target=run, args=(client2, e2))
        t2.start()

        e1.wait()
        e2.wait()
        guard.set()
        t1.join()
        t2.join()

        self.assertIs(Client.get_client(specification), None)
