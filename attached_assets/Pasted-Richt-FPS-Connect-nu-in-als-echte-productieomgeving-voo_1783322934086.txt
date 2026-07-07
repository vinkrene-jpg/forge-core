Richt FPS Connect nu in als echte productieomgeving voor bedrijfsdata.

Doel:
De huidige Kantoor Release v1.0.0 moet draaien in een gescheiden productie-deployment, los van development/test. Deze omgeving wordt gebruikt voor echte bedrijfsdata van FPS.

Eisen:

1. Maak of bevestig een aparte productie-deployment voor FPS Connect.
   - Geen development-preview.
   - Geen tijdelijke Replit-preview als werkplek voor echte data.
   - Productie moet een vaste URL hebben.
   - Development en productie mogen geen database of storage delen.

2. Richt productie-database in.
   - Eigen DATABASE_URL voor productie.
   - Migraties uitvoeren.
   - Seed alleen noodzakelijke basisdata.
   - Geen testdata tenzij expliciet gemarkeerd.
   - Controleer tabellen, rollen en bestaande release v1.0.0.

3. Richt productie-storage in.
   - Eigen STORAGE_DIR of externe storage voor documenten/foto’s.
   - Geen gedeelde storage met development.
   - Test upload/download van documenten.
   - Controleer bestandsrechten.

4. Richt productie-secrets in.
   - SESSION_SECRET productie-uniek.
   - AI-provider keys alleen via production secrets.
   - Azure/mail secrets alleen productie.
   - Geen secrets in GitHub.
   - Geen hergebruik van development-secrets.

5. Beveiliging.
   - Alleen geautoriseerde gebruikers.
   - Hoofdbeheerderaccount controleren.
   - Beheerpagina’s alleen hoofdbeheerder.
   - Normale gebruiker mag niet bij beheer/release/security/CQO.
   - HTTPS verplicht.
   - Geen publieke debug/endpoints.

6. Back-up.
   - Maak vóór ingebruikname een nul-backup.
   - Database-backup.
   - Storage-backup.
   - Documenteer restore-procedure.
   - Test minimaal één restore-drill of droge restorecontrole.

7. Release.
   - Activeer Kantoor Release v1.0.0.
   - Controleer /release-notes.
   - Controleer /beheer/kantoor-release.
   - Rollbackmogelijkheid bevestigen.

8. Smoke test.
   Controleer minimaal:
   - login
   - gebouwen
   - documenten
   - upload
   - planning
   - gebruikers
   - voorzieningen
   - rapportage
   - beheerdermenu
   - rechten normale gebruiker
   - audit/logging
   - backupstatus

9. Opleverrapport.
   Rapporteer:
   - productie-URL
   - database-status
   - storage-status
   - actieve release
   - backup-locatie
   - uitgevoerde migraties
   - testresultaten
   - bekende beperkingen
   - rollbackprocedure

Belangrijk:
Voeg geen nieuwe functionaliteit toe. Dit is uitsluitend productie-inrichting, release, verificatie en overdracht.