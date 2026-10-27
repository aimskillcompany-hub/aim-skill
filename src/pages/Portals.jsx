// «Портали постачальників» (міграція 107): усі портали, перехід однією кнопкою, логін і пароль — копіюванням.
import PortalList from '../components/PortalList'
import { InfoTip } from '../components/ui'
import '../components/PortalList.css'

export default function Portals() {
  return (
    <div className="ptl-page">
      <div>
        <h1>Портали постачальників<InfoTip label="Портали постачальників">Посилання, логіни й паролі до B2B-порталів дистриб’юторів. «Відкрити портал» відкриває сайт у новій вкладці; логін і пароль копіюються кнопкою. Пароль зберігається зашифрованим; бачать його всі, крім ролі «перегляд», кожен перегляд пишеться в журнал.</InfoTip></h1>
      </div>
      <PortalList />
    </div>
  )
}
