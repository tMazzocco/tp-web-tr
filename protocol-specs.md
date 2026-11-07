Protocole

Timeout après 15s 

ORCHESTRATION DES APPELS 

Poignée de main initiale :
- Serveur A: -> /syn : Initie la poignée de main, garder note de qui a été contacté si succès

    -> Si aucune réponse (timeout), supprimer qu'on a essayé de contacter B

- Serveur B: Reçois /syn, envois 202 pour accepter prend note de renvoyer syn-ack
- Serveur B: -> /syn-ack : Réciproque la poignée de main
- Serveur A: Reçois /syn-ack, envois 202 pour accepter et prend note de renvoyer ack
- Serveur A: -> /ack : Confirme la connexion réussie, sauvegarde B en status Ack si succès
- Serveur B: Reçois /ack, envois 204 pour valider (no content) et sauvegarde A en status Ack

-> Pour /syn-ack et /ack, faire un système de retry et oublier la poignée de main en cas d'échec

Keep-Alive :
Pour toutes les connexions:

    - envois /health régulier (~5s à 10s), ajouter l'Origin en header si vérif connexion aussi

    -> Si erreur, exponential back-off avec nombre fixe de retry (5 default)

    -> Si toujours erreur, oublis de la connexion

    - /health reçu => si sans origin juste renvoyer 204, sinon renvoyer 202 et lancer une requête /pong


=> On garde en mémoire le nombre de ping par Origin envoyées, chaque /pong reçu on réinitialise le compteur, si 5 /ping envoyés avec header.Origin sans réponse /pong retour, alors on oublie la connexion

Communication :
Envois d'un message :
    Pour toutes les connexions:
        - Envois sur /ingress du message (avec action et eventuellement payload)
 
Réception message :
    - Si Origin connectée, accepter le message et le traiter, autrement refuser la requête
    - Timeout -> retry autorisé

Partie B:
    Register:
        - Serveur A envois /register au Broker
        - Broker retient "A" = url-A
        - Broker renvois à A tout les id=url retenues jusque-là
        - Broker renvois à toutes les ip retenues jusque-là que "A" = url-A
        
Partie C:
-> Handshake: 
    - A -> /broker/syn/A (Origin: ipA) -> B -> B remember "A" = ipA + A = syn
    - B -> /syn-ack/ (Origin: ipB) -> A remembered ipB as ACK
    - B -> /register (Body {url:{url}; id:{id}}) -> A remember "B" = ipB
    
    


ROUTES 

    Je propose un header standard par route pour transmettre la clé publique X25519 du serveur émetteur :

    Signature-Input => {"sig1":{ "keyid": <clé-X25519-du-serveur> }}, 

    => envoyé sous la forme Signature-Input: sig1=();keyid="<clé-X25519-du-serveur>" (clé publique de 32 octets, en base64url).

    Une requête sans header Signature-Input, ou avec une clé invalide, est refusée en 401.

    Si un serveur connu présente une autre clé que celle échangée au handshake, sa requête est refusée en 403.

    => Chaque serveur se partage le même secret partagé au Handshake, et ils pourront alors encrypt(...) et decrypt(...) leurs messages.


Sur toutes les requêtes: 500 : Erreur de serveurs 

DELETE /unregister/:id
Renvoie : 

     - 204 (no-content)  

     - 404 (not-found)   


PARTIE B
POST /register 
Body => { id: <ID>, url: <URL> } 

-> Même requête dans le service broker/tracker (??? -> donc les clients ont /broker/tracker au lieu de /register partie B?)

PARTIE C

On conserve POST /register de la partie B

POST /broker/syn/{id} (avec headers.Origin=URL)
Initiation de la poignée de main avec id Broker (partie C)
{id} = identifiant à enregistrer pour celui lançant la requête

(-> Déclanchera un /broker/syn-ack/{id} et non un /syn-ack ???)

=> Je préfère qu'on branche le /broker/syn/{id} sur le /syn-ack classique
=> Validé, /broker/syn-ack/{id} déclanchera à la fois un /syn-ack classique + /register séparé en même temps (ou un broker/tracker??) 

(voir process)

POST /syn (avec headers.Origin=URL)
initiation de la poignée de main
Renvoie: 
    - 202 (Accepted)
    - 400 si  Origin manquante

POST /syn-ack (avec headers.Origin=URL) + (si broker) Query id 
Acceptation de la poignée de main, initiation de la réciprocité de la connexion
Renvoie: 

    - 202 (Accepted)

    - 400 si Origin manquante

    - 403 si jamais contacté (/syn requis d'abord)


POST /ack (avec headers.Origin=URL)
Réciprocité de la poignée de main finale
Renvoie: 

     - 204 (No-Content)

     - 400 si  Origin manquante

     - 403 (si pas status syn (/syn-ack requis d'abord)



POST /forget (avec headers.Origin=URL)
Suppression de l'enregistrement de l'origin dans les serveurs connus
Renvoie:  

    - 204 (No-Content)

    - 400 (Mauvais payload / pas d'origin / action non-définie)

    - 403 (non autorisé - pas encore ack)


POST /ingress (avec headers.Origin=URL)
Transmission d'un message à une connexion établie
Body => { 
    action: "XXXXX", 
    metadata: { 
        source: <URL>,
        target:  <URL>,
        timestamp: <Date_ISO_String> 
    },  
    payload?:  { ... } 
}
Renvoie:

    - 201 (Created)

    - 208 (Conflit métier - message déjà existant)

    - 400 (pas d'origin / payload malformé)

    - 403 (pas de connexion établie avec cet Origin)


GET /health (avec OPTIONAL headers.Origin=URL)
Renvoie:
    - 204 (Si pas d'origin)
    - 202 (accepted et envoie un /pong à l'origin)
Ping vérifiant que le host est toujours up (pas vérif auth)

 POST /pong (avec headers.Origin=URL)
 Réponse à un Ping reçu d'un serveur
 Renvoie: 
     - 204 (Aucun soucis)
     - 403 (Serveur inconnu)






